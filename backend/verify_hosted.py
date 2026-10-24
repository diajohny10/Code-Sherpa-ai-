"""Explicit staging-only hosted smoke test; secrets never appear in reports.

Run: python -m backend.verify_hosted --staging
The owner connection is needed for migration/cleanup; use no real-user database.
"""

import argparse
import asyncio
import json
import logging
import os
import secrets
import io
import unittest
from http.cookies import SimpleCookie
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "verification" / "hosted-smoke.json"


def report(state):
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


async def verify(state):
    from .accounts import AuthSettings, ProgressState
    from .database import PostgresAccountsStore
    from .main import create_app
    from .migrate import migrate
    from .security import AdmissionLimits
    from tests.test_backend_security import request

    dsn = os.environ.get("SHERPA_MIGRATION_DATABASE_URL") or os.environ.get("SHERPA_DATABASE_URL")
    if not dsn:
        raise ValueError("Missing database configuration")
    state["phase"] = "migrations"
    report(state)
    await migrate(dsn)
    state["migration_verified"] = True
    admin = PostgresAccountsStore(dsn)
    await admin.start()
    store = PostgresAccountsStore(os.environ["SHERPA_DATABASE_URL"])
    settings = AuthSettings()
    app = create_app(AdmissionLimits(auth_requests_per_window=100),
                     accounts_store=store, auth_settings=settings)
    emails = []
    origin = [(b"origin", settings.origins[0].encode())]

    def session_headers(headers, body):
        jar = SimpleCookie()
        jar.load(headers[b"set-cookie"].decode())
        return origin + [(b"cookie", ("sherpa_session=" + jar["sherpa_session"].value).encode()),
                         (b"x-csrf-token", body["csrf_token"].encode())]

    def expect(response, status):
        if response[0] != status:
            raise AssertionError(f"Unexpected HTTP status {response[0]}")
        return response

    async with app.router.lifespan_context(app):
        try:
            state["phase"] = "private_schema"
            report(state)
            async with admin.connection() as connection:
                protected = await connection.fetchval(
                    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE ((n.nspname='sherpa_private' AND c.relname IN ('users','sessions','progress')) "
                    "OR (n.nspname='public' AND c.relname='sherpa_schema_migrations')) AND c.relrowsecurity")
                assert protected == 4
                roles = await connection.fetch("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")
                for role in roles:
                    assert not await connection.fetchval(
                        "SELECT has_schema_privilege($1,'sherpa_private','USAGE,CREATE')", role["rolname"])
                    for table in ("sherpa_private.users", "sherpa_private.sessions", "sherpa_private.progress", "public.sherpa_schema_migrations"):
                        assert not await connection.fetchval(
                            "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')",
                            role["rolname"], table)
            state["api_roles_denied"] = True
            state["phase"] = "account_roundtrip"
            report(state)
            password = secrets.token_urlsafe(32)
            for _ in range(2):
                email = "sherpa-smoke-" + uuid4().hex + "@example.test"
                emails.append(email)
                result = expect(await request(app, "/api/auth/register", {
                    "email": email, "password": password,
                }, headers=origin), 200)
                auth = session_headers(result[1], result[2])
                if len(emails) == 1:
                    first, first_body = auth, result[2]
                else:
                    second = auth
            state["registration"] = True
            progress = ProgressState(xp=120).model_dump()
            write = {"progress": progress, "revision": first_body["revision"]}
            saved = expect(await request(app, "/api/progress", write, method="PUT", headers=first), 200)
            assert saved[2]["progress"] == progress
            expect(await request(app, "/api/progress", write, method="PUT", headers=first), 409)
            other = expect(await request(app, "/api/progress", method="GET", headers=second), 200)
            assert other[2]["progress"]["xp"] == 0
            expect(await request(app, "/api/progress", write, method="PUT",
                                 headers=[item for item in first if item[0] != b"x-csrf-token"]), 403)
            logged = expect(await request(app, "/api/auth/login", {
                "email": emails[0], "password": password,
            }, headers=first), 200)
            current = session_headers(logged[1], logged[2])
            assert logged[2]["progress"] == progress
            expect(await request(app, "/api/progress", method="GET", headers=first), 401)
            expect(await request(app, "/api/auth/logout", {}, headers=current), 200)
            expect(await request(app, "/api/progress", method="GET", headers=current), 401)
            state.update(progress_persistence=True, revision_conflicts=True, user_isolation=True,
                         csrf_enforced=True, session_rotation=True, logout_revocation=True)
            async with admin.connection() as connection:
                await connection.execute(
                    "UPDATE sherpa_private.sessions SET expires_at=now()-interval '1 second' "
                    "WHERE user_id=(SELECT id FROM sherpa_private.users WHERE email=$1)", emails[1])
            expect(await request(app, "/api/progress", method="GET", headers=second), 401)
            state["session_expiry"] = True
        finally:
            state["phase"] = "cleanup"
            report(state)
            async with admin.connection() as connection:
                await connection.execute("DELETE FROM sherpa_private.users WHERE email=ANY($1::text[])", emails)
                remaining = await connection.fetchval(
                    "SELECT count(*) FROM sherpa_private.users WHERE email=ANY($1::text[])", emails)
                state["temporary_accounts_remaining"] = remaining
                assert remaining == 0
                state["staging_test_accounts_remaining"] = await connection.fetchval(
                    "SELECT count(*) FROM sherpa_private.users WHERE email LIKE 'sherpa-%@example.test'")
            await admin.close()
    state.update(status="passed", phase="complete")


def main():
    parser = argparse.ArgumentParser(description="Staging-only real PostgreSQL account smoke test")
    parser.add_argument("--staging", action="store_true", required=True,
                        help="Acknowledge this is an isolated staging project and permit temporary accounts")
    parser.add_argument("--integration-tests", action="store_true",
                        help="Run the original hosted integration suite with redacted output")
    parser.add_argument("--all-tests", action="store_true",
                        help="Run all backend tests with the approved hosted suite enabled")
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False, encoding="utf-8-sig")
    os.environ["SHERPA_ENABLE_PAID_AI"] = "false"
    logging.getLogger("asyncio").setLevel(logging.CRITICAL)
    if args.integration_tests or args.all_tests:
        owner = os.environ.get("SHERPA_MIGRATION_DATABASE_URL") or os.environ.get("SHERPA_DATABASE_URL")
        if not owner:
            raise SystemExit("Database configuration is required.")
        os.environ["SHERPA_TEST_DATABASE_URL"] = owner
        os.environ["SHERPA_TEST_ISOLATED_PROJECT"] = "true"
        # Unit tests must not accidentally start a hosted store. Only the
        # explicit integration suite receives the owner URI via its test key.
        os.environ.pop("SHERPA_DATABASE_URL", None)
        os.environ.pop("SHERPA_MIGRATION_DATABASE_URL", None)
        suite = (unittest.defaultTestLoader.discover(str(ROOT / "tests"), top_level_dir=str(ROOT))
                 if args.all_tests else unittest.defaultTestLoader.loadTestsFromName("tests.test_postgres_integration"))
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        summary = {"run": result.testsRun, "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
                   "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped),
                   "failed_test_ids": [test.id() for test, _ in result.failures + result.errors]}
        target = ROOT / "verification" / ("backend-all.json" if args.all_tests else "supabase-integration.json")
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print("HOSTED_TESTS=" + json.dumps(summary), flush=True)
        raise SystemExit(0 if result.wasSuccessful() and not result.skipped else 1)
    state = {"status": "running", "phase": "starting"}
    report(state)

    async def bounded():
        async with asyncio.timeout(120):
            await verify(state)

    try:
        asyncio.run(bounded())
    except Exception as error:
        state.update(status="failed", error_type=type(error).__name__)
    report(state)
    print("HOSTED_SMOKE=" + json.dumps(state), flush=True)
    raise SystemExit(0 if state["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
