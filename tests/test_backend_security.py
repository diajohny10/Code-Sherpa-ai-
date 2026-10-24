"""Exercise the real ASGI middleware/router with no HTTP-client dependency."""

import asyncio
import json
import threading
import unittest
from unittest.mock import Mock, patch

from backend.ai_provider import DemoLearningProvider, InvalidProviderResponse, LearningProviderError
from backend.main import create_app
from backend.security import AdmissionLimits


async def request(app, path="/api/learning/plan", payload=None, *, raw=None,
                  chunks=None, headers=None, peer="192.0.2.1", receiver=None,
                  method="POST", root_path=""):
    if chunks is None:
        body = raw if raw is not None else json.dumps(
            payload if payload is not None else {"prompt": "prime", "use_ai": True}
        ).encode()
        chunks = [body]
    messages = [{"type": "http.request", "body": chunk,
                 "more_body": index < len(chunks) - 1}
                for index, chunk in enumerate(chunks)]

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    sent = []

    async def send(message):
        sent.append(message)

    await app({
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": path,
        "raw_path": path.encode(), "query_string": b"", "root_path": root_path,
        "headers": [(b"host", b"test"), (b"content-type", b"application/json")]
                   + (headers or []),
        "client": (peer, 1234), "server": ("test", 80),
    }, receiver or receive, send)
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    response_headers = dict(next(message["headers"] for message in sent
                                 if message["type"] == "http.response.start"))
    body = b"".join(message.get("body", b"") for message in sent
                    if message["type"] == "http.response.body")
    return status, response_headers, json.loads(body) if body else None


class BackendSecurityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Any accidental external call fails the test, even if a real key exists
        # in the invoking developer's environment.
        network = patch("backend.ai_provider.urllib.request.build_opener",
                        side_effect=AssertionError("Network is forbidden in security tests"))
        network.start()
        self.addCleanup(network.stop)

    def make_app(self, clock=None, **kwargs):
        app = create_app(AdmissionLimits(**kwargs), **({"clock": clock} if clock else {}))
        self.addCleanup(app.state.provider_runner.shutdown)
        return app

    async def test_rate_is_shared_across_all_ai_endpoints_and_modes(self):
        app = self.make_app(requests_per_window=2, enable_paid_ai=True)
        provider = DemoLearningProvider()
        with patch("backend.main.select_provider", return_value=provider) as select:
            self.assertEqual((await request(app))[0], 200)
            self.assertEqual((await request(app, "/api/learning/hints", {
                "prompt": "prime", "requirements": [], "use_ai": False,
            }))[0], 200)
            status, headers, _ = await request(app, "/api/learning/mentor", {
                "prompt": "prime", "question": "Why?", "use_ai": True,
            })
            self.assertEqual(status, 429)
            self.assertGreater(int(headers[b"retry-after"]), 0)
            self.assertEqual(select.call_count, 2)
            # Health remains available under learning load.
            self.assertEqual((await request(app, "/api/health", raw=b"", method="GET"))[0], 200)

    async def test_rate_expiry_and_forwarded_header_spoofing(self):
        now = [0.0]
        app = self.make_app(clock=lambda: now[0], requests_per_window=1, rate_window_seconds=10)
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()) as select:
            self.assertEqual((await request(app))[0], 200)
            self.assertEqual((await request(app, headers=[
                (b"x-forwarded-for", b"198.51.100.99"), (b"x-real-ip", b"198.51.100.99"),
            ]))[0], 429)
            now[0] = 10
            self.assertEqual((await request(app))[0], 200)
            self.assertEqual(select.call_count, 2)

    async def test_mounted_root_path_cannot_bypass_shared_rate_limit(self):
        for path in ("/sherpa/api/learning/plan", "/api/learning/plan"):
            with self.subTest(path=path):
                app = self.make_app(requests_per_window=1)
                with patch("backend.main.select_provider", return_value=DemoLearningProvider()) as select:
                    self.assertEqual((await request(app, path, root_path="/sherpa"))[0], 200)
                    self.assertEqual((await request(app, path, root_path="/sherpa"))[0], 429)
                    select.assert_called_once()

    async def test_client_map_does_not_evict_active_quotas(self):
        now = [0.0]
        app = self.make_app(clock=lambda: now[0], requests_per_window=1,
                            max_tracked_clients=1, rate_window_seconds=10)
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()):
            self.assertEqual((await request(app))[0], 200)
            self.assertEqual((await request(app, peer="192.0.2.2"))[0], 429)
            self.assertEqual((await request(app))[0], 429)
            now[0] = 10
            self.assertEqual((await request(app, peer="192.0.2.2"))[0], 200)

    async def test_paid_budget_is_global_across_peers_and_endpoints(self):
        app = self.make_app(enable_paid_ai=True, paid_requests_per_window=1)
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()) as select:
            self.assertEqual((await request(app))[0], 200)
            status, headers, _ = await request(app, "/api/learning/hints", {
                "prompt": "prime", "requirements": [], "use_ai": True,
            }, peer="192.0.2.2")
            self.assertEqual(status, 429)
            self.assertIn(b"retry-after", headers)
            select.assert_called_once_with(True)
            self.assertEqual((await request(app, payload={"prompt": "prime", "use_ai": False}))[0], 200)
            self.assertEqual(select.call_args.args, (False,))

    async def test_configured_key_alone_does_not_enable_paid_ai(self):
        app = self.make_app()
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()) as select:
            result = await request(app)
        self.assertEqual(result[0], 200)
        self.assertTrue(result[2]["ai_unavailable"])
        select.assert_called_once_with(False)

    async def test_declared_oversize_rejected_before_reading_or_provider_selection(self):
        app = self.make_app(body_bytes=100)
        receiver = Mock(side_effect=AssertionError("oversized declared body must not be read"))
        with patch("backend.main.select_provider") as select:
            result = await request(app, headers=[(b"content-length", b"101")], receiver=receiver)
        self.assertEqual(result[0], 413)
        select.assert_not_called()
        receiver.assert_not_called()

    async def test_actual_body_bytes_reject_chunked_and_forged_length(self):
        app = self.make_app(body_bytes=100)
        for headers in ([], [(b"content-length", b"1")]):
            with self.subTest(headers=headers), patch("backend.main.select_provider") as select:
                result = await request(app, chunks=[b" " * 60, b" " * 41], headers=headers)
                self.assertEqual(result[0], 413)
                select.assert_not_called()

    async def test_body_limit_counts_utf8_bytes_not_characters(self):
        app = self.make_app(body_bytes=100)
        raw = json.dumps({"prompt": "\u00e9" * 50, "use_ai": True}, ensure_ascii=False).encode()
        with patch("backend.main.select_provider") as select:
            self.assertEqual((await request(app, raw=raw))[0], 413)
            select.assert_not_called()

    async def test_exact_body_limit_is_accepted(self):
        app = self.make_app(body_bytes=100)
        raw = b'{"prompt":"prime","use_ai":false}'
        raw += b" " * (100 - len(raw))
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()):
            self.assertEqual((await request(app, raw=raw, headers=[(b"content-length", b"100")]))[0], 200)

    async def test_malformed_content_lengths_fail_before_provider(self):
        app = self.make_app()
        for headers in ([(b"content-length", b"-1")], [(b"content-length", b"oops")],
                        [(b"content-length", b"2"), (b"content-length", b"2")]):
            with self.subTest(headers=headers), patch("backend.main.select_provider") as select:
                self.assertEqual((await request(app, headers=headers))[0], 400)
                select.assert_not_called()

    async def test_slow_body_has_total_deadline_before_provider(self):
        app = self.make_app(body_timeout_seconds=0.02)

        async def stalled_receive():
            await asyncio.Event().wait()

        with patch("backend.main.select_provider") as select:
            self.assertEqual((await request(app, receiver=stalled_receive))[0], 408)
            select.assert_not_called()

    async def test_item_bounds_counts_blank_values_and_strict_opt_in(self):
        app = self.make_app(requests_per_window=100)
        invalid = [
            ("/api/learning/hints", {"requirements": ["x" * 501]}),
            ("/api/learning/mentor", {"requirements": ["x" * 501]}),
            ("/api/learning/mentor", {"test_results": ["x" * 301]}),
            ("/api/learning/hints", {"requirements": ["x"] * 13}),
            ("/api/learning/mentor", {"requirements": ["x"] * 13}),
            ("/api/learning/mentor", {"test_results": ["x"] * 13}),
            ("/api/learning/hints", {"requirements": [" " * 10]}),
            ("/api/learning/mentor", {"test_results": [""]}),
            ("/api/learning/plan", {"prompt": " "}),
            ("/api/learning/mentor", {"question": " "}),
            ("/api/learning/plan", {"use_ai": "true"}),
            ("/api/learning/plan", {"use_ai": 1}),
            ("/api/learning/plan", {"unknown_field": "not permitted"}),
        ]
        with patch("backend.main.select_provider") as select:
            for path, fields in invalid:
                with self.subTest(path=path, fields=fields):
                    payload = {"prompt": "prime", "use_ai": True, **fields}
                    if path.endswith("mentor"):
                        payload.setdefault("question", "Why?")
                    self.assertEqual((await request(app, path, payload))[0], 422)
            select.assert_not_called()

    async def test_list_items_at_exact_limits_remain_valid(self):
        app = self.make_app()
        with patch("backend.main.select_provider", return_value=DemoLearningProvider()):
            self.assertEqual((await request(app, "/api/learning/mentor", {
                "prompt": "prime", "question": "Why?", "requirements": ["x" * 500] * 12,
                "test_results": ["x" * 300] * 12,
            }))[0], 200)

    async def test_http_timeout_retains_capacity_and_returns_safe_errors(self):
        app = self.make_app(provider_concurrency=1, provider_timeout_seconds=0.03,
                            enable_paid_ai=True)
        started, release, finished = threading.Event(), threading.Event(), threading.Event()

        class BlockingProvider(DemoLearningProvider):
            def create_plan(self, prompt):
                started.set()
                release.wait()
                try:
                    return super().create_plan(prompt)
                finally:
                    finished.set()

        with patch("backend.main.select_provider", return_value=BlockingProvider()) as select:
            task = asyncio.create_task(request(app))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                result = await asyncio.wait_for(task, 2)
                self.assertEqual(result[0], 504)
                self.assertEqual(result[2], {"detail": "Learning provider deadline exceeded."})
                self.assertEqual((await request(app))[0], 429)
                select.assert_called_once()
            finally:
                release.set()
                await asyncio.gather(task, return_exceptions=True)
                self.assertTrue(await asyncio.to_thread(finished.wait, 2))

    async def test_provider_failures_remain_sanitized(self):
        app = self.make_app()
        for error in (LearningProviderError("secret"), InvalidProviderResponse("secret")):
            with self.subTest(error=error), patch("backend.main.select_provider", return_value=DemoLearningProvider()):
                with patch("backend.main.create_plan_safely", side_effect=error):
                    status, _, body = await request(app)
                self.assertEqual(status, 502)
                self.assertNotIn("secret", json.dumps(body))

    async def test_lifespan_shuts_down_runner(self):
        app = self.make_app()
        async with app.router.lifespan_context(app):
            pass
        with self.assertRaisesRegex(RuntimeError, "shut down"):
            await app.state.provider_runner.run(lambda: None)


class ConfigurationTests(unittest.TestCase):
    def test_invalid_limits_fail_closed(self):
        for kwargs in ({"body_bytes": 0}, {"requests_per_window": -1},
                       {"provider_concurrency": True}, {"paid_requests_per_window": 0},
                       {"provider_timeout_seconds": float("inf")},
                       {"body_timeout_seconds": float("nan")}, {"enable_paid_ai": "true"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                AdmissionLimits(**kwargs)

    def test_environment_config_is_explicit_and_validated(self):
        with patch.dict("os.environ", {"SHERPA_ENABLE_PAID_AI": "true",
                                      "SHERPA_REQUESTS_PER_WINDOW": "7"}, clear=True):
            config = AdmissionLimits.from_environ()
            self.assertTrue(config.enable_paid_ai)
            self.assertEqual(config.requests_per_window, 7)
        with patch.dict("os.environ", {"SHERPA_ENABLE_PAID_AI": "yes"}, clear=True):
            with self.assertRaises(ValueError):
                AdmissionLimits.from_environ()


if __name__ == "__main__":
    unittest.main()
