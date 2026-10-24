"""Account contract tests using a test-only store and the real ASGI boundary."""

import asyncio
import copy
import importlib.util
import threading
import types
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from backend.accounts import (
    AuthSettings, DUMMY_HASH, ProgressState, csrf_token, password_work, token_hash,
)
from backend.database import DatabaseUnavailable, DuplicateEmail, PostgresAccountsStore, RevisionConflict
from backend.main import create_app
from backend.security import AdmissionLimits
from tests.test_backend_security import request

ORIGIN = [(b"origin", b"http://127.0.0.1:5173")]
PASSWORD = "a long test password"


def session_headers(headers, body, *, csrf=True):
    jar = SimpleCookie()
    jar.load(headers[b"set-cookie"].decode())
    result = ORIGIN + [(b"cookie", ("sherpa_session=" + jar["sherpa_session"].value).encode())]
    if csrf:
        result.append((b"x-csrf-token", body["csrf_token"].encode()))
    return result


class MemoryAccountsStore:
    """Deliberately test-only; production never instantiates this class."""

    def __init__(self):
        self.users = {}
        self.sessions = {}
        self.progress = {}
        self.mutations = 0

    async def start(self):
        pass

    async def close(self):
        pass

    async def find_user(self, email):
        return next((user for user in self.users.values() if user["email"] == email), None)

    async def register(self, email, encoded, token, expires, previous, progress):
        if await self.find_user(email):
            raise DuplicateEmail()
        user_id = str(uuid4())
        self.users[user_id] = {"id": user_id, "email": email, "password_hash": encoded}
        self.progress[user_id] = (copy.deepcopy(progress), 0)
        return await self.login(user_id, token, expires, previous)

    async def login(self, user_id, token, expires, previous):
        self.sessions.pop(previous, None)
        self.sessions[token] = (user_id, expires)
        self.mutations += 1
        return self.snapshot(user_id)

    def snapshot(self, user_id):
        user = self.users[user_id]
        progress, revision = self.progress[user_id]
        return {"id": user_id, "email": user["email"]}, copy.deepcopy(progress), revision

    async def session(self, token):
        session = self.sessions.get(token)
        if not session or session[1] <= datetime.now(timezone.utc):
            return None
        return self.snapshot(session[0])

    async def logout(self, token):
        self.sessions.pop(token, None)
        self.mutations += 1

    async def save_progress(self, token, progress, revision):
        session = await self.session(token)
        if not session:
            return None
        user_id = session[0]["id"]
        if self.progress[user_id][1] != revision:
            raise RevisionConflict()
        self.progress[user_id] = copy.deepcopy(progress), revision + 1
        self.mutations += 1
        return copy.deepcopy(progress), revision + 1


class AccountTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = MemoryAccountsStore()
        self.hasher = patch("backend.accounts.password_work", side_effect=self.password_stub)
        self.work = self.hasher.start()
        self.addCleanup(self.hasher.stop)
        self.environment = patch.dict("os.environ", {"SHERPA_DATABASE_URL": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.app = self.make_app()

    @staticmethod
    def password_stub(password, encoded=None):
        return "test-hash:" + password if encoded is None else encoded == "test-hash:" + password

    def make_app(self, **limits):
        app = create_app(AdmissionLimits(**limits), accounts_store=self.store,
                         auth_settings=AuthSettings())
        self.addCleanup(app.state.provider_runner.shutdown)
        self.addCleanup(app.state.auth_runner.shutdown)
        return app

    async def register(self, email="User@Example.com", headers=None, peer="192.0.2.1"):
        return await request(self.app, "/api/auth/register", {
            "email": email, "password": PASSWORD,
        }, headers=ORIGIN if headers is None else headers, peer=peer)

    async def test_register_cookie_normalization_session_and_default_progress(self):
        status, headers, body = await self.register("  USER@Example.com  ")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["email"], "user@example.com")
        self.assertEqual(body["progress"], ProgressState().model_dump())
        self.assertEqual(body["revision"], 0)
        self.assertTrue(body["database_enabled"])
        cookie = headers[b"set-cookie"].decode()
        for part in ("HttpOnly", "SameSite=lax", "Secure", "Path=/api", "Max-Age=604800"):
            self.assertIn(part, cookie)
        self.assertEqual(headers[b"cache-control"], b"no-store")
        auth = session_headers(headers, body)
        result = await request(self.app, "/api/auth/session", method="GET", raw=b"", headers=auth)
        self.assertEqual(result[2], body)
        raw = auth[1][1].decode().split("=", 1)[1]
        self.assertNotIn(raw, self.store.sessions)
        self.assertIn(token_hash(raw), self.store.sessions)

    async def test_duplicate_email_and_invalid_login_are_sanitized(self):
        await self.register()
        self.assertEqual((await self.register("user@example.com"))[0], 409)
        for email in ("user@example.com", "missing@example.com"):
            result = await request(self.app, "/api/auth/login", {
                "email": email, "password": "incorrect password",
            }, headers=ORIGIN)
            self.assertEqual(result[0], 401)
            self.assertEqual(result[2], {"detail": "Invalid email or password."})
        self.assertEqual(self.work.call_args.args[1], DUMMY_HASH)

    async def test_login_and_registration_rotate_previous_session(self):
        _, headers, body = await self.register()
        old = session_headers(headers, body)
        result = await request(self.app, "/api/auth/login", {
            "email": "USER@example.com", "password": PASSWORD,
        }, headers=old)
        self.assertEqual(result[0], 200)
        new = session_headers(result[1], result[2])
        self.assertNotEqual(old[1], new[1])
        self.assertEqual((await request(self.app, "/api/progress", raw=b"", method="GET", headers=old))[0], 401)
        other = await self.register("other@example.com", headers=new)
        self.assertEqual(other[0], 200)
        self.assertEqual((await request(self.app, "/api/progress", raw=b"", method="GET", headers=new))[0], 401)

    async def test_logout_revokes_and_deletes_cookie(self):
        _, headers, body = await self.register()
        auth = session_headers(headers, body)
        result = await request(self.app, "/api/auth/logout", {}, headers=auth)
        self.assertEqual(result[0], 200)
        self.assertEqual(result[2], {"ok": True})
        self.assertIn(b"Max-Age=0", result[1][b"set-cookie"])
        self.assertIn(b"Path=/api", result[1][b"set-cookie"])
        self.assertEqual((await request(self.app, "/api/progress", method="GET", raw=b"", headers=auth))[0], 401)

    async def test_expired_session_is_guest_but_protected_endpoint_is_401(self):
        _, headers, body = await self.register()
        auth = session_headers(headers, body)
        for token, (user_id, _) in self.store.sessions.items():
            self.store.sessions[token] = user_id, datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertIsNone((await request(self.app, "/api/auth/session", method="GET", headers=auth))[2]["user"])
        self.assertEqual((await request(self.app, "/api/progress", method="GET", headers=auth))[0], 401)

    async def test_origin_rejected_before_body_hashing_or_mutation(self):
        for path, method in (("/api/auth/register", "POST"), ("/api/auth/login", "POST"),
                             ("/api/auth/logout", "POST"), ("/api/progress", "PUT")):
            for origin in ([], [(b"origin", b"https://evil.example")], ORIGIN + ORIGIN):
                receiver = Mock(side_effect=AssertionError("Must not read body"))
                result = await request(self.app, path, headers=origin, method=method, receiver=receiver)
                self.assertEqual(result[0], 403)
                self.assertEqual(result[1][b"cache-control"], b"no-store")
                receiver.assert_not_called()
        self.work.assert_not_called()
        self.assertEqual(self.store.mutations, 0)

    async def test_csrf_is_required_bound_to_session_and_checked_before_mutation(self):
        _, headers, body = await self.register()
        first = session_headers(headers, body, csrf=False)
        _, _, other = await self.register("other@example.com")
        for token in (None, "wrong", other["csrf_token"], "\u00e9"):
            auth = first + ([(b"x-csrf-token", token.encode())] if token else [])
            for path, method in (("/api/auth/logout", "POST"), ("/api/progress", "PUT")):
                before = self.store.mutations
                self.assertEqual((await request(self.app, path, {}, headers=auth, method=method))[0], 403)
                self.assertEqual(self.store.mutations, before)

    async def test_progress_cas_conflict_and_user_isolation(self):
        _, headers, body = await self.register()
        first = session_headers(headers, body)
        _, headers, body = await self.register("other@example.com")
        second = session_headers(headers, body)
        progress = ProgressState(xp=80).model_dump()
        write = {"progress": progress, "revision": 0}
        result = await request(self.app, "/api/progress", write, method="PUT", headers=first)
        self.assertEqual(result[0], 200)
        self.assertEqual(result[2], {"progress": progress, "revision": 1})
        self.assertEqual((await request(self.app, "/api/progress", write, method="PUT", headers=first))[0], 409)
        untouched = await request(self.app, "/api/progress", method="GET", headers=second)
        self.assertEqual(untouched[2], {"progress": ProgressState().model_dump(), "revision": 0})
        self.assertEqual((await request(self.app, "/api/progress", {**write, "user_id": body["user"]["id"]},
                                       method="PUT", headers=first))[0], 422)

    async def test_progress_strict_bounds_dates_and_verified_claims(self):
        _, headers, body = await self.register()
        auth = session_headers(headers, body)
        history = {"challengeId": "prime", "kind": "learning", "completedAt": "2026-10-24T00:00:00Z",
                   "score": 100, "hintsUsed": 0, "verifiedTestsPassed": False}
        coverage = {"challengeId": "prime", "recordedAt": "2026-10-24T00:00:00Z", "score": 50,
                    "passed": 1, "missing": 1, "untested": 0}
        invalid = [
            {"history": [{**history, "verifiedTestsPassed": True}]},
            {"history": [{**history, "verifiedTestsPassed": 0}]},
            {"history": [{**history, "completedAt": "not a date"}]},
            {"history": [{**history, "completedAt": "2026-10-24"}]},
            {"history": [{**history, "completedAt": "20261024T000000Z"}]},
            {"history": [{**history, "completedAt": "2026-W43-6T00:00:00Z"}]},
            {"history": [{**history, "completedAt": "2026-10-24 00:00:00Z"}]},
            {"history": [{**history, "completedAt": "2026-10-24T00:00:00+00:00:01"}]},
            {"history": [history] * 201}, {"coverageResults": [coverage] * 201},
            {"coverageResults": [{**coverage, "recordedAt": "invalid"}]},
            {"coverageResults": [{**coverage, "passed": 201}]},
            {"unlockedAchievements": ["passed-tests"]},
            {"rewardedEvents": ["achievement:passed-tests"]},
            {"completedChallengeIds": ["x" * 201]}, {"xp": True}, {"version": True},
            {"xp": 1_000_001}, {"completed_challenge_ids": []},
        ]
        for changes in invalid:
            payload = {"progress": {**ProgressState().model_dump(), **changes}, "revision": 0}
            self.assertEqual((await request(self.app, "/api/progress", payload, method="PUT", headers=auth))[0], 422)
        valid = {**ProgressState().model_dump(), "history": [history], "coverageResults": [coverage]}
        result = await request(self.app, "/api/progress", {"progress": valid, "revision": 0},
                               method="PUT", headers=auth)
        self.assertEqual(result[0], 200)
        self.assertEqual(result[2]["progress"], valid)

    async def test_credential_errors_never_echo_input_and_auth_body_limit_still_applies(self):
        for fields in ({"password": "short-secret"[:11]}, {"password": "x" * 129},
                       {"password": 123}, {"email": "not-an-email"}, {"user_id": "attacker"}):
            result = await request(self.app, "/api/auth/register", {
                "email": "user@example.com", "password": PASSWORD, **fields,
            }, headers=ORIGIN)
            self.assertEqual(result[0], 422)
            self.assertEqual(result[2], {"detail": "Request contains invalid values."})
        self.work.assert_not_called()
        result = await request(self.app, "/api/auth/register", raw=b"x" * 65537,
                               headers=ORIGIN, peer="192.0.2.2")
        self.assertEqual(result[0], 413)

    async def test_auth_shared_rate_limit_before_hashing_separate_from_learning_and_mounted(self):
        for path in ("/api/auth/login", "/sherpa/api/auth/login"):
            app = self.make_app()
            for attempt in range(5):
                endpoint = path if attempt % 2 else path.replace("login", "register")
                result = await request(app, endpoint, {"email": "new@example.com", "password": PASSWORD},
                                       headers=ORIGIN, root_path="/sherpa")
                self.assertIn(result[0], {200, 401, 409})
            before = self.work.call_count
            result = await request(app, path, {}, headers=ORIGIN, root_path="/sherpa")
            self.assertEqual(result[0], 429)
            self.assertIn(b"retry-after", result[1])
            self.assertEqual(self.work.call_count, before)
            self.assertEqual((await request(app, payload={"prompt": "prime", "use_ai": False}))[0], 200)

    async def test_disabled_database_and_unavailable_database(self):
        app = create_app(auth_settings=AuthSettings())
        self.addCleanup(app.state.provider_runner.shutdown)
        self.addCleanup(app.state.auth_runner.shutdown)
        result = await request(app, "/api/auth/session", method="GET")
        self.assertEqual(result[2], {"user": None, "csrf_token": None, "progress": None,
                                    "revision": None, "database_enabled": False})
        self.assertEqual(result[1][b"cache-control"], b"no-store")
        for path, method in (("/api/auth/register", "POST"), ("/api/auth/login", "POST"),
                             ("/api/progress", "GET"), ("/api/progress", "PUT")):
            self.assertEqual((await request(app, path, {}, method=method, headers=ORIGIN))[0], 503)
        with patch.object(self.store, "find_user", side_effect=DatabaseUnavailable("secret DSN")):
            result = await request(self.app, "/api/auth/login", {
                "email": "user@example.com", "password": PASSWORD}, headers=ORIGIN)
        self.assertEqual(result[0], 503)
        self.assertNotIn("secret", str(result[2]))

    async def test_auth_runner_timeout_retains_both_slots(self):
        from backend.ai_provider import ProviderTaskRunner

        self.app.state.auth_runner.shutdown()
        self.app.state.auth_runner = ProviderTaskRunner(max_concurrency=2, timeout_seconds=0.03)
        self.addCleanup(self.app.state.auth_runner.shutdown)
        release = threading.Event()
        finished = [threading.Event(), threading.Event()]
        counter = iter(range(2))

        def blocked(*args):
            index = next(counter)
            try:
                release.wait(2)
                return "encoded"
            finally:
                finished[index].set()

        try:
            with patch("backend.accounts.password_work", side_effect=blocked):
                results = await asyncio.gather(self.register("one@example.com"), self.register("two@example.com"))
                self.assertEqual([result[0] for result in results], [503, 503])
                self.assertEqual((await self.register("three@example.com"))[0], 429)
        finally:
            release.set()
            for event in finished:
                self.assertTrue(await asyncio.to_thread(event.wait, 2))

    async def test_cors_is_explicit_and_credentialed(self):
        result = await request(self.app, "/api/auth/session", method="GET", headers=ORIGIN)
        self.assertEqual(result[1][b"access-control-allow-origin"], ORIGIN[0][1])
        self.assertEqual(result[1][b"access-control-allow-credentials"], b"true")
        result = await request(self.app, "/api/auth/session", method="GET",
                               headers=[(b"origin", b"https://evil.example")])
        self.assertNotIn(b"access-control-allow-origin", result[1])

    async def test_cors_preflight_is_no_store(self):
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            return {"type": "http.request", "body": b""}

        await self.app({
            "type": "http", "method": "OPTIONS", "path": "/api/progress", "root_path": "",
            "headers": ORIGIN + [(b"access-control-request-method", b"PUT"),
                                   (b"access-control-request-headers", b"X-CSRF-Token")],
        }, receive, send)
        start = next(message for message in sent if message["type"] == "http.response.start")
        self.assertEqual(start["status"], 200)
        self.assertEqual(dict(start["headers"])[b"cache-control"], b"no-store")


class SettingsAndPasswordTests(unittest.TestCase):
    def test_insecure_cookies_require_only_loopback_origins(self):
        AuthSettings(cookie_secure=False)
        AuthSettings(origins=("http://[::1]:5173",), cookie_secure=False)
        for origin in ("*", "null", "http://localhost:5173/path", "https://user:pass@example.com",
                       "http://localhost:invalid", "http://localhost:5173/", "https://*.example.com",
                       "http://localhost:5173?", "http://localhost:5173#", "http://local host:5173"):
            with self.assertRaises(ValueError):
                AuthSettings(origins=(origin,))
        with self.assertRaises(ValueError):
            AuthSettings(origins=("https://app.example.com",), cookie_secure=False)

    @unittest.skipUnless(importlib.util.find_spec("argon2"), "argon2-cffi not installed")
    def test_real_argon2id_and_dummy_verification(self):
        encoded = password_work(PASSWORD)
        self.assertTrue(encoded.startswith("$argon2id$"))
        self.assertNotIn(PASSWORD, encoded)
        self.assertTrue(password_work(PASSWORD, encoded))
        self.assertFalse(password_work("wrong password", encoded))
        self.assertFalse(password_work(PASSWORD, DUMMY_HASH))


class SQLBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_rotation_does_not_prune_global_backlog_and_maintenance_is_bounded(self):
        connection = Mock()
        connection.execute = AsyncMock()
        connection.fetchval = AsyncMock(return_value=3)
        store = PostgresAccountsStore("not-used")

        @asynccontextmanager
        async def connect():
            yield connection

        store.connection = connect
        await store._rotate(connection, "user", "token", datetime.now(timezone.utc), "previous")
        delete = connection.execute.call_args_list[0]
        self.assertEqual(delete.args, ("DELETE FROM sherpa_private.sessions WHERE token_hash = $1", "previous"))
        self.assertEqual(await store.prune_expired_sessions(10), 3)
        sql, count = connection.fetchval.call_args.args
        self.assertIn("LIMIT $1", sql)
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("FROM sherpa_private.sessions", sql)
        self.assertEqual(count, 10)
        for invalid in (0, 1001, True, "10"):
            with self.assertRaises(ValueError):
                await store.prune_expired_sessions(invalid)

    async def test_pool_is_bounded_and_closed_by_lifespan(self):
        pool = Mock()
        pool.close = AsyncMock()
        driver = types.SimpleNamespace(create_pool=AsyncMock(return_value=pool))
        store = PostgresAccountsStore("postgresql://test:fake-password@localhost/test")
        app = create_app(accounts_store=store, auth_settings=AuthSettings())
        with patch.dict("sys.modules", {"asyncpg": driver}):
            async with app.router.lifespan_context(app):
                self.assertIs(store._pool, pool)
                settings = driver.create_pool.call_args.kwargs
                self.assertLessEqual(settings["max_size"], 5)
                self.assertEqual(settings["timeout"], 5)
                self.assertEqual(settings["command_timeout"], 5)
        pool.close.assert_awaited_once()
        self.assertIsNone(store._pool)

    async def test_pool_failure_is_sanitized_and_shutdown_can_terminate(self):
        store = PostgresAccountsStore("postgresql://test:fake-password@localhost/test")
        driver = types.SimpleNamespace(create_pool=AsyncMock(side_effect=RuntimeError("secret DSN")))
        with patch.dict("sys.modules", {"asyncpg": driver}):
            with self.assertRaises(DatabaseUnavailable) as result:
                await store.start()
        self.assertNotIn("secret", str(result.exception))
        pool = Mock()
        pool.close = AsyncMock(side_effect=TimeoutError())
        store._pool = pool
        await store.close()
        pool.terminate.assert_called_once()
        self.assertIsNone(store._pool)

    async def test_sql_uses_parameters_for_untrusted_values(self):
        class Connection:
            def __init__(self):
                self.calls = []

            async def fetchrow(self, sql, *parameters):
                self.calls.append((sql, parameters))
                return None

            async def execute(self, sql, *parameters):
                self.calls.append((sql, parameters))

            async def fetchval(self, sql, *parameters):
                self.calls.append((sql, parameters))
                return None

            @asynccontextmanager
            async def transaction(self):
                yield

        connection = Connection()
        store = PostgresAccountsStore("not-used")

        @asynccontextmanager
        async def connect():
            yield connection

        store.connection = connect
        attack = "'; DROP TABLE users; --"
        self.assertIsNone(await store.find_user(attack))
        self.assertIsNone(await store.session(attack))
        await store.logout(attack)
        expires = datetime.now(timezone.utc)
        await store.register(attack, "encoded", "token", expires, "previous", {})
        self.assertIsNone(await store.login(attack, "token", expires, "previous"))
        self.assertIsNone(await store.save_progress(attack, {}, 0))
        await store.prune_expired_sessions(1)
        for sql, parameters in connection.calls:
            self.assertNotIn(attack, sql)
            self.assertIn("$1", sql)
            self.assertIn("sherpa_private.", sql)
            self.assertNotRegex(sql, r"\b(?:FROM|JOIN|INTO|UPDATE) (?:users|sessions|progress)\b")
        self.assertEqual(connection.calls[0][1], (attack,))
        self.assertEqual(connection.calls[1][1], (attack,))
        self.assertEqual(connection.calls[2][1], (attack,))