import asyncio
import gc
import http.client
import io
import json
import socket
import threading
import time
import unittest
import urllib.error
from concurrent.futures import Future
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend.ai_provider import (
    InvalidProviderResponse,
    LearningProviderError,
    OpenAILearningProvider,
    ProviderBudgetExceeded,
    ProviderCapacityExceeded,
    ProviderDeadlineExceeded,
    ProviderTaskRunner,
    _DeadlineHTTPResponse,
    _DeadlineHTTPSConnection,
    _NoProviderRedirects,
    _provider_deadline,
    create_hints_safely,
    create_mentor_safely,
    create_plan_safely,
)


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    def make_runner(self, **kwargs):
        runner = ProviderTaskRunner(**kwargs)
        self.addCleanup(runner.shutdown)
        return runner

    async def wait_event(self, event):
        self.assertTrue(await asyncio.to_thread(event.wait, 2), "worker barrier timed out")

    def observe_completion(self, runner):
        finished = threading.Event()
        self.loop_errors = []
        loop = asyncio.get_running_loop()
        original_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda current_loop, context: self.loop_errors.append(context))
        self.addCleanup(loop.set_exception_handler, original_handler)
        submit = runner._executor.submit

        def capture(*args, **kwargs):
            future = submit(*args, **kwargs)
            self.worker_future = future
            return future

        patcher = patch.object(runner._executor, "submit", side_effect=capture)
        patcher.start()
        self.addCleanup(patcher.stop)
        return finished

    async def test_capacity_rejects_immediately_before_spending_budget(self):
        runner = self.make_runner(max_concurrency=1, paid_request_limit=1)
        started, release = threading.Event(), threading.Event()

        def blocking():
            started.set()
            release.wait()
            return "finished"

        task = asyncio.create_task(runner.run(blocking))
        try:
            await self.wait_event(started)
            rejected = Mock()
            with self.assertRaises(ProviderCapacityExceeded):
                await runner.run(rejected, paid=True)
            rejected.assert_not_called()
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
        self.assertEqual(await runner.run(lambda: "paid", paid=True), "paid")
        with self.assertRaises(ProviderBudgetExceeded):
            await runner.run(rejected, paid=True)
        rejected.assert_not_called()

    async def test_budget_is_shared_by_concurrent_callers_and_free_work_is_allowed(self):
        runner = self.make_runner(max_concurrency=2, paid_request_limit=1)
        started, release = threading.Event(), threading.Event()

        def blocking():
            started.set()
            release.wait()

        task = asyncio.create_task(runner.run(blocking, paid=True))
        try:
            await self.wait_event(started)
            rejected = Mock()
            with self.assertRaises(ProviderBudgetExceeded):
                await runner.run(rejected, paid=True)
            rejected.assert_not_called()
            self.assertEqual(await runner.run(lambda: 7), 7)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    async def test_paid_budget_uses_rolling_expiry_not_a_fixed_window(self):
        clock = FakeClock()
        runner = self.make_runner(clock=clock, paid_request_limit=2, paid_window_seconds=10)
        await runner.run(lambda: None, paid=True)
        clock.now = 4
        await runner.run(lambda: None, paid=True)
        clock.now = 9.99
        with self.assertRaises(ProviderBudgetExceeded):
            await runner.run(lambda: None, paid=True)
        clock.now = 10
        await runner.run(lambda: None, paid=True)
        with self.assertRaises(ProviderBudgetExceeded):
            await runner.run(lambda: None, paid=True)
        clock.now = 14
        await runner.run(lambda: None, paid=True)

    async def test_timeout_retains_slot_and_budget_until_worker_finishes(self):
        runner = self.make_runner(max_concurrency=1, timeout_seconds=0.03, paid_request_limit=1)
        started, release = threading.Event(), threading.Event()
        finished = self.observe_completion(runner)

        def blocking():
            started.set()
            release.wait()
            raise RuntimeError("late worker exception")

        task = asyncio.create_task(runner.run(blocking, paid=True))
        try:
            await self.wait_event(started)
            self.worker_future.add_done_callback(lambda future: finished.set())
            with self.assertRaises(ProviderDeadlineExceeded):
                await task
            with self.assertRaises(ProviderCapacityExceeded):
                await runner.run(lambda: None, paid=True)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            await self.wait_event(finished)
        self.assertEqual(await runner.run(lambda: "released"), "released")
        with self.assertRaises(ProviderBudgetExceeded):
            await runner.run(lambda: None, paid=True)
        gc.collect()
        self.assertEqual(self.loop_errors, [])

    async def test_cancellation_retains_slot_until_worker_finishes(self):
        runner = self.make_runner(max_concurrency=1)
        started, release = threading.Event(), threading.Event()
        finished = self.observe_completion(runner)

        def blocking():
            started.set()
            release.wait()
            raise RuntimeError("late cancelled worker exception")

        task = asyncio.create_task(runner.run(blocking))
        try:
            await self.wait_event(started)
            self.worker_future.add_done_callback(lambda future: finished.set())
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            with self.assertRaises(ProviderCapacityExceeded):
                await runner.run(lambda: None)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            await self.wait_event(finished)
        self.assertEqual(await runner.run(lambda: "released"), "released")
        gc.collect()
        self.assertEqual(self.loop_errors, [])

    async def test_success_and_exception_release_capacity(self):
        runner = self.make_runner(max_concurrency=1)
        self.assertEqual(await runner.run(lambda first, second: first + second, 2, 3), 5)

        def fail():
            raise ValueError("expected failure")

        with self.assertRaisesRegex(ValueError, "expected failure"):
            await runner.run(fail)
        self.assertEqual(await runner.run(lambda: 9), 9)

    async def test_shutdown_returns_while_worker_blocked_and_rejects_new_work(self):
        runner = self.make_runner(max_concurrency=1)
        started, release = threading.Event(), threading.Event()

        def blocking():
            started.set()
            release.wait()

        task = asyncio.create_task(runner.run(blocking))
        try:
            await self.wait_event(started)
            runner.shutdown()
            with self.assertRaisesRegex(RuntimeError, "shut down"):
                await runner.run(lambda: None)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    async def test_expired_worker_does_not_invoke_function(self):
        clock = FakeClock()
        runner = self.make_runner(clock=clock)
        function = Mock()

        def delayed_submit(invoke):
            future = Future()
            clock.now = 21
            try:
                future.set_result(invoke())
            except BaseException as exc:
                future.set_exception(exc)
            return future

        with patch.object(runner._executor, "submit", side_effect=delayed_submit):
            with self.assertRaises(ProviderDeadlineExceeded):
                await runner.run(function)
        function.assert_not_called()
        self.assertEqual(await runner.run(lambda: "released"), "released")

    async def test_submit_failure_rolls_back_capacity_and_budget(self):
        runner = self.make_runner(max_concurrency=1, paid_request_limit=1)
        with patch.object(runner._executor, "submit", side_effect=RuntimeError("submit failed")):
            with self.assertRaisesRegex(RuntimeError, "submit failed"):
                await runner.run(lambda: None, paid=True)
        self.assertEqual(await runner.run(lambda: 1, paid=True), 1)

    async def test_result_delivered_after_deadline_is_rejected(self):
        clock = FakeClock()
        runner = self.make_runner(clock=clock, timeout_seconds=0.03)

        def finishes_late():
            clock.now = 0.04
            return "too late"

        with self.assertRaises(ProviderDeadlineExceeded):
            await runner.run(finishes_late)

    async def test_worker_receives_and_resets_deadline_context(self):
        runner = self.make_runner(max_concurrency=1)
        deadline, clock = await runner.run(_provider_deadline.get)
        self.assertGreater(deadline, clock())
        self.assertIsNone(_provider_deadline.get())
        self.assertIsNone(runner._executor.submit(_provider_deadline.get).result(timeout=2))


class Response:
    def __init__(self, body):
        self.body = io.BytesIO(body)
        self.connection = Mock()
        self.fp = SimpleNamespace(raw=SimpleNamespace(_sock=self.connection))
        self.read = Mock(side_effect=AssertionError("read1 should be preferred"))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read1(self, size):
        return self.body.read(size)


class AdapterTests(unittest.TestCase):
    def response(self):
        return Response(json.dumps({"output": [{"content": [
            {"type": "output_text", "text": json.dumps({"hints": ["Try a boundary"]})}
        ]}]}).encode())

    def test_payload_caps_output_tokens_and_chunk_reads_update_socket_deadline(self):
        provider = OpenAILearningProvider("not-a-real-key", timeout=2)
        response = self.response()
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.return_value = response
            self.assertEqual(provider.create_hints("task", []).hints, ["Try a boundary"])
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(json.loads(request.data)["max_output_tokens"], 1200)
        timeout = build.return_value.open.call_args.kwargs["timeout"]
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 2)
        self.assertGreaterEqual(response.connection.settimeout.call_count, 2)
        for call in response.connection.settimeout.call_args_list:
            self.assertGreater(call.args[0], 0)
            self.assertLessEqual(call.args[0], timeout)
        response.read.assert_not_called()
        self.assertTrue(any(isinstance(handler, _NoProviderRedirects)
                    for handler in build.call_args.args))

    def test_custom_token_cap(self):
        provider = OpenAILearningProvider("test", max_output_tokens=4096)
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.return_value = self.response()
            provider.create_hints("task", [])
        self.assertEqual(json.loads(build.return_value.open.call_args.args[0].data)["max_output_tokens"], 4096)

    def test_expired_inherited_deadline_prevents_network_call(self):
        clock = FakeClock()
        token = _provider_deadline.set((0, clock))
        try:
            with patch("backend.ai_provider.urllib.request.build_opener") as build:
                with self.assertRaises(ProviderDeadlineExceeded):
                    OpenAILearningProvider("test").create_hints("task", [])
                build.return_value.open.assert_not_called()
        finally:
            _provider_deadline.reset(token)

    def test_inherited_deadline_checked_between_chunk_reads(self):
        clock = FakeClock()
        token = _provider_deadline.set((0.03, clock))
        response = self.response()
        original_read = response.read1

        def slow_read(size):
            clock.now = 0.04
            return original_read(size)

        response.read1 = Mock(side_effect=slow_read)
        try:
            with patch("backend.ai_provider.urllib.request.build_opener") as build:
                build.return_value.open.return_value = response
                with self.assertRaises(ProviderDeadlineExceeded):
                    OpenAILearningProvider("test").create_hints("task", [])
                self.assertLessEqual(build.return_value.open.call_args.kwargs["timeout"], 0.03)
                response.read1.assert_called_once()
        finally:
            _provider_deadline.reset(token)

    def test_own_deadline_checked_between_reads(self):
        response = self.response()
        with patch("backend.ai_provider.time.monotonic", side_effect=[0, 0, 0, 1]):
            with patch("backend.ai_provider.urllib.request.build_opener") as build:
                build.return_value.open.return_value = response
                with self.assertRaises(ProviderDeadlineExceeded):
                    OpenAILearningProvider("test", timeout=0.03).create_hints("task", [])

    def test_actual_response_bytes_are_capped(self):
        response = Response(b" " * 1_000_001)
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.return_value = response
            with self.assertRaisesRegex(InvalidProviderResponse, "byte limit"):
                OpenAILearningProvider("test").create_hints("task", [])
        self.assertEqual(response.body.tell(), 1_000_001)

    def test_socket_timeouts_are_deadline_errors_and_public_errors_are_sanitized(self):
        for error in (socket.timeout("secret"), urllib.error.URLError(socket.timeout("secret"))):
            with self.subTest(error=error):
                with patch("backend.ai_provider.urllib.request.build_opener") as build:
                    build.return_value.open.side_effect = error
                    with self.assertRaises(ProviderDeadlineExceeded) as raised:
                        OpenAILearningProvider("test").create_hints("task", [])
                    self.assertNotIn("secret", str(raised.exception))
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.side_effect = urllib.error.URLError("secret credential")
            with self.assertRaises(LearningProviderError) as raised:
                OpenAILearningProvider("test").create_hints("task", [])
            self.assertNotIn("secret", str(raised.exception))

    def test_socket_timeout_during_read_is_deadline_error(self):
        response = self.response()
        response.read1 = Mock(side_effect=socket.timeout("secret"))
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.return_value = response
            with self.assertRaises(ProviderDeadlineExceeded):
                OpenAILearningProvider("test").create_hints("task", [])

    def test_redirects_are_rejected_without_forwarding_authorization(self):
        response = Mock()
        with self.assertRaises(LearningProviderError):
            _NoProviderRedirects().redirect_request(
                Mock(), response, 302, "redirect", {}, "https://untrusted.example/")
        response.close.assert_called_once_with()

    def test_http_error_response_is_closed_and_sanitized(self):
        body = io.BytesIO(b"secret credential")
        error = urllib.error.HTTPError("https://example.invalid", 401, "secret", {}, body)
        with patch("backend.ai_provider.urllib.request.build_opener") as build:
            build.return_value.open.side_effect = error
            with self.assertRaisesRegex(LearningProviderError, "^AI provider request failed$"):
                OpenAILearningProvider("test").create_hints("task", [])
        self.assertTrue(body.closed)

    def test_deadline_abort_open_errors_are_deadline_errors(self):
        for error in (OSError("secret"), urllib.error.URLError("secret")):
            with self.subTest(error=error):
                clock = FakeClock()
                token = _provider_deadline.set((1, clock))

                def abort(*args, **kwargs):
                    clock.now = 2
                    raise error

                try:
                    with patch("backend.ai_provider.urllib.request.build_opener") as build:
                        build.return_value.open.side_effect = abort
                        with self.assertRaises(ProviderDeadlineExceeded):
                            OpenAILearningProvider("test").create_hints("task", [])
                finally:
                    _provider_deadline.reset(token)

    def test_safe_wrappers_preserve_deadline_exception_identity(self):
        deadline = ProviderDeadlineExceeded("Provider request deadline exceeded")
        provider = Mock()
        provider.create_plan.side_effect = deadline
        provider.create_hints.side_effect = deadline
        provider.create_mentor.side_effect = deadline
        context = {"prompt": "task", "requirements": [], "test_results": [],
                   "challenge": "", "learner_text": ""}
        for function, args in (
            (create_plan_safely, (provider, "task")),
            (create_hints_safely, (provider, "task", [])),
            (create_mentor_safely, (provider, context, "question")),
        ):
            with self.subTest(function=function.__name__):
                with self.assertRaises(ProviderDeadlineExceeded) as raised:
                    function(*args)
                self.assertIs(raised.exception, deadline)


class DeadlineResponseTests(unittest.TestCase):
    def test_slow_drip_headers_and_body_are_interrupted_by_absolute_deadline(self):
        for phase in ("headers", "body"):
            with self.subTest(phase=phase):
                client, server = socket.socketpair()
                client.settimeout(2)
                server.settimeout(2)
                stop = threading.Event()
                deadline = time.monotonic() + 0.2

                def drip():
                    try:
                        prefix = (b"HTTP/1.1 200 OK\r\nX-Slow: " if phase == "headers" else
                                  b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\n\r\n")
                        server.sendall(prefix)
                        while not stop.wait(0.01):
                            server.sendall(b"a")
                    except OSError:
                        pass

                writer = threading.Thread(target=drip)
                responses = []

                def make_response(*args, **kwargs):
                    response = _DeadlineHTTPResponse(*args, **kwargs)
                    responses.append(response)
                    return response

                def connect(connection):
                    connection.sock = client

                writer.start()
                try:
                    with patch("backend.ai_provider.urllib.request.getproxies", return_value={}):
                        with patch.object(_DeadlineHTTPSConnection, "connect", connect):
                            with patch("backend.ai_provider._DeadlineHTTPResponse", side_effect=make_response):
                                with self.assertRaises(ProviderDeadlineExceeded):
                                    OpenAILearningProvider("test", timeout=0.2).create_hints("task", [])
                    self.assertGreaterEqual(time.monotonic(), deadline)
                    self.assertLess(time.monotonic(), deadline + 1)
                    self.assertEqual(len(responses), 1)
                    self.assertTrue(responses[0].closed)
                    self.assertFalse(responses[0]._deadline_timer.is_alive())
                finally:
                    stop.set()
                    for response in responses:
                        response.close()
                    client.close()
                    server.close()
                    writer.join(2)
                self.assertFalse(writer.is_alive())

    def test_watchdog_interrupts_single_blocking_body_read(self):
        client, server = socket.socketpair()
        client.settimeout(2)
        server.settimeout(2)
        stop = threading.Event()
        deadline = time.monotonic() + 0.2

        def remaining():
            seconds = deadline - time.monotonic()
            if seconds <= 0:
                raise ProviderDeadlineExceeded("Provider request deadline exceeded")
            return seconds

        def drip():
            try:
                while not stop.wait(0.01):
                    server.sendall(b"a")
            except OSError:
                pass

        response = None
        writer = threading.Thread(target=drip)
        try:
            server.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\n\r\n")
            response = _DeadlineHTTPResponse(client, remaining=remaining)
            response.begin()
            client.close()
            writer.start()
            with self.assertRaises((OSError, http.client.IncompleteRead)):
                response.read()
            self.assertGreaterEqual(time.monotonic(), deadline)
            self.assertLess(time.monotonic(), deadline + 1)
        finally:
            stop.set()
            if response is not None:
                response.close()
            client.close()
            server.close()
            if writer.ident is not None:
                writer.join(2)
        self.assertFalse(writer.is_alive())
        self.assertFalse(response._deadline_timer.is_alive())

    def test_header_parse_error_cancels_watchdog(self):
        client, server = socket.socketpair()
        client.settimeout(2)
        connection = _DeadlineHTTPSConnection("example.invalid", remaining=lambda: 10)
        responses = []
        factory = connection.response_class

        def make_response(*args, **kwargs):
            response = factory(*args, **kwargs)
            responses.append(response)
            return response

        connection.response_class = make_response
        connection.sock = client
        try:
            server.sendall(b"not an HTTP status\r\n")
            connection.request("GET", "/")
            with self.assertRaises(http.client.BadStatusLine):
                connection.getresponse()
            self.assertEqual(len(responses), 1)
            self.assertTrue(responses[0].closed)
            self.assertFalse(responses[0]._deadline_timer.is_alive())
        finally:
            connection.close()
            for response in responses:
                response.close()
            client.close()
            server.close()

    def test_close_cancels_watchdog_before_deadline(self):
        client, server = socket.socketpair()
        try:
            response = _DeadlineHTTPResponse(client, remaining=lambda: 10)
            response.close()
            self.assertFalse(response._deadline_timer.is_alive())
            server.sendall(b"still connected")
            self.assertEqual(client.recv(15), b"still connected")
        finally:
            client.close()
            server.close()

    def test_expired_deadline_does_not_start_timer(self):
        remaining = Mock(side_effect=ProviderDeadlineExceeded("expired"))
        with patch("backend.ai_provider.threading.Timer") as timer:
            with self.assertRaises(ProviderDeadlineExceeded):
                _DeadlineHTTPResponse(Mock(), remaining=remaining)
            timer.assert_not_called()


class ConfigurationTests(unittest.TestCase):
    def test_paid_budget_is_shared_across_event_loops_but_runner_local(self):
        runner = ProviderTaskRunner(paid_request_limit=1)
        other = ProviderTaskRunner(paid_request_limit=1)
        try:
            self.assertEqual(asyncio.run(runner.run(lambda: 1, paid=True)), 1)
            with self.assertRaises(ProviderBudgetExceeded):
                asyncio.run(runner.run(lambda: None, paid=True))
            self.assertEqual(asyncio.run(other.run(lambda: 2, paid=True)), 2)
        finally:
            runner.shutdown()
            other.shutdown()

    def test_invalid_runner_configuration(self):
        for name in ("max_concurrency", "paid_request_limit"):
            for value in (True, False, 0, -1, 1.5, float("inf"), float("nan"), "2", None):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    ProviderTaskRunner(**{name: value})
        for name in ("timeout_seconds", "paid_window_seconds"):
            for value in (True, False, 0, -1, float("inf"), float("nan"), 10 ** 1000, "2", None):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    ProviderTaskRunner(**{name: value})
        with self.assertRaises(ValueError):
            ProviderTaskRunner(clock=None)

    def test_invalid_adapter_configuration(self):
        for value in (True, False, 0, -1, 4097, 1.5, float("inf"), float("nan")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                OpenAILearningProvider("test", max_output_tokens=value)
        for value in (True, False, 0, -1, float("inf"), float("nan")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                OpenAILearningProvider("test", timeout=value)


if __name__ == "__main__":
    unittest.main()