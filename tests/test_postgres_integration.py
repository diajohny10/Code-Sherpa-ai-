"""Opt-in real PostgreSQL checks, restricted to a dedicated test database.

Set SHERPA_TEST_DATABASE_URL to a URI whose database name contains a standalone
`test` segment (e.g. sherpa_test). Only rows created here are deleted afterward.
Never point this suite at a user/production database.
"""

import os
import re
import unittest
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4

from backend.accounts import AuthSettings, ProgressState, token_hash
from backend.database import PostgresAccountsStore
from backend.main import create_app
from backend.migrate import migrate
from backend.security import AdmissionLimits
from tests.test_accounts import ORIGIN, PASSWORD, session_headers
from tests.test_backend_security import request


@unittest.skipUnless(os.environ.get("SHERPA_TEST_DATABASE_URL"), "SHERPA_TEST_DATABASE_URL is not set")
class PostgresIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        dsn = os.environ["SHERPA_TEST_DATABASE_URL"]
        database = unquote(urlsplit(dsn).path.lstrip("/"))
        host = urlsplit(dsn).hostname or ""
        isolated_supabase = (
            os.environ.get("SHERPA_TEST_ISOLATED_PROJECT") == "true"
            and database == "postgres"
            and (host.endswith(".supabase.co") or host.endswith(".pooler.supabase.com"))
        )
        if not re.search(r"(^|[_-])test([_-]|$)", database, re.IGNORECASE) and not isolated_supabase:
            self.skipTest("Use a dedicated test database or explicitly acknowledged isolated Supabase staging project")
        try:
            await migrate(dsn)
            await migrate(dsn)
            self.store = PostgresAccountsStore(dsn)
            self.app = create_app(AdmissionLimits(auth_requests_per_window=100),
                                  accounts_store=self.store, auth_settings=AuthSettings())
            self.lifespan = self.app.router.lifespan_context(self.app)
            await self.lifespan.__aenter__()
        except Exception:
            self.fail("Test database setup failed; check dedicated database configuration")
        self.emails = []
        self.addAsyncCleanup(self.cleanup_database)

    async def cleanup_database(self):
        try:
            async with self.store.connection() as connection:
                for email in self.emails:
                    await connection.execute("DELETE FROM sherpa_private.users WHERE email = $1", email)
        finally:
            await self.lifespan.__aexit__(None, None, None)
            self.assertIsNone(self.store._pool)

    async def register(self):
        email = f"sherpa-{uuid4().hex}@example.test"
        self.emails.append(email)
        status, headers, body = await request(self.app, "/api/auth/register", {
            "email": email.upper(), "password": PASSWORD,
        }, headers=ORIGIN)
        self.assertEqual(status, 200)
        return email, session_headers(headers, body), body

    async def test_private_schema_rls_and_api_role_isolation(self):
        async with self.store.connection() as connection:
            for table in ("users", "sessions", "progress"):
                with self.subTest(table=table):
                    self.assertIsNone(await connection.fetchval(
                        "SELECT pg_catalog.to_regclass($1)", f"public.{table}"))
                    self.assertIsNotNone(await connection.fetchval(
                        "SELECT pg_catalog.to_regclass($1)", f"sherpa_private.{table}"))
            self.assertIsNotNone(await connection.fetchval(
                "SELECT pg_catalog.to_regclass('public.sherpa_schema_migrations')"))
            tables = await connection.fetch(
                "SELECT relation.oid, relation.relname, relation.relrowsecurity, "
                "relation.relforcerowsecurity FROM pg_catalog.pg_class AS relation "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace "
                "WHERE (namespace.nspname = 'sherpa_private' "
                "AND relation.relname IN ('users', 'sessions', 'progress')) "
                "OR (namespace.nspname = 'public' AND relation.relname = 'sherpa_schema_migrations')")
            self.assertEqual(len(tables), 4)
            for table in tables:
                with self.subTest(table=table["relname"]):
                    self.assertTrue(table["relrowsecurity"])
                    self.assertFalse(table["relforcerowsecurity"])
                    self.assertEqual(await connection.fetchval(
                        "SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = $1 "
                        "AND (0 = ANY(polroles) OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles "
                        "WHERE rolname IN ('anon', 'authenticated', 'service_role') "
                        "AND oid = ANY(polroles)))", table["oid"]), 0)
                    grants = await connection.fetchval(
                        "SELECT count(*) FROM pg_catalog.pg_class AS relation "
                        "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, "
                        "pg_catalog.acldefault('r', relation.relowner))) AS grant_entry "
                        "WHERE relation.oid = $1 AND (grant_entry.grantee = 0 OR "
                        "grant_entry.grantee IN (SELECT oid FROM pg_catalog.pg_roles "
                        "WHERE rolname IN ('anon', 'authenticated', 'service_role')))", table["oid"])
                    self.assertEqual(grants, 0)
            self.assertEqual(await connection.fetchval(
                "SELECT count(*) FROM pg_catalog.pg_namespace AS namespace "
                "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl, "
                "pg_catalog.acldefault('n', namespace.nspowner))) AS grant_entry "
                "WHERE namespace.nspname = 'sherpa_private' AND (grant_entry.grantee = 0 OR "
                "grant_entry.grantee IN (SELECT oid FROM pg_catalog.pg_roles "
                "WHERE rolname IN ('anon', 'authenticated', 'service_role')))"), 0)
            roles = await connection.fetch(
                "SELECT rolname FROM pg_catalog.pg_roles "
                "WHERE rolname IN ('anon', 'authenticated', 'service_role')")
            for role in roles:
                with self.subTest(role=role["rolname"]):
                    self.assertFalse(await connection.fetchval(
                        "SELECT pg_catalog.has_schema_privilege($1, 'sherpa_private', 'USAGE, CREATE')",
                        role["rolname"]))
                    for table in tables:
                        self.assertFalse(await connection.fetchval(
                            "SELECT pg_catalog.has_table_privilege($1, $2::oid, "
                            "'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')",
                            role["rolname"], table["oid"]))
            migrations = Path(__file__).resolve().parent.parent / "migrations"
            for version in ("001_accounts.sql", "002_private_accounts.sql"):
                checksum = await connection.fetchval(
                    "SELECT checksum FROM public.sherpa_schema_migrations WHERE version = $1", version)
                self.assertEqual(checksum, sha256((migrations / version).read_text(encoding="utf-8").encode()).hexdigest())

    async def test_real_roundtrip_rotation_cas_isolation_and_cleanup(self):
        first_email, first, body = await self.register()
        _, second, _ = await self.register()
        self.assertEqual(body["progress"], ProgressState().model_dump())
        progress = ProgressState(xp=120).model_dump()
        result = await request(self.app, "/api/progress", {"progress": progress, "revision": 0},
                               method="PUT", headers=first)
        self.assertEqual(result[0], 200)
        self.assertEqual(result[2]["revision"], 1)
        stale = await request(self.app, "/api/progress", {"progress": progress, "revision": 0},
                              method="PUT", headers=first)
        self.assertEqual(stale[0], 409)
        other = await request(self.app, "/api/progress", method="GET", headers=second)
        self.assertEqual(other[2]["progress"]["xp"], 0)
        login = await request(self.app, "/api/auth/login", {
            "email": first_email, "password": PASSWORD,
        }, headers=first)
        self.assertEqual(login[0], 200)
        current = session_headers(login[1], login[2])
        self.assertEqual(login[2]["progress"], progress)
        self.assertEqual(login[2]["revision"], 1)
        self.assertEqual((await request(self.app, "/api/progress", method="GET", headers=first))[0], 401)
        session = await request(self.app, "/api/auth/session", method="GET", headers=current)
        self.assertEqual(session[2]["user"]["email"], first_email)
        async with self.store.connection() as connection:
            encoded = await connection.fetchval("SELECT password_hash FROM sherpa_private.users WHERE email = $1", first_email)
            self.assertTrue(encoded.startswith("$argon2id$"))
            count = await connection.fetchval("SELECT count(*) FROM public.sherpa_schema_migrations")
            self.assertGreaterEqual(count, 2)
            raw = current[1][1].decode().split("=", 1)[1]
            stored = await connection.fetchval("SELECT token_hash FROM sherpa_private.sessions WHERE user_id = $1",
                                                UUID(body["user"]["id"]))
            self.assertEqual(stored, token_hash(raw))
            self.assertFalse(await connection.fetchval("SELECT 1 FROM sherpa_private.sessions WHERE token_hash = $1", raw))
        logout = await request(self.app, "/api/auth/logout", {}, headers=current)
        self.assertEqual(logout[0], 200)
        self.assertEqual((await request(self.app, "/api/progress", method="GET", headers=current))[0], 401)

    async def test_expiry_and_foreign_key_cascade(self):
        email, auth, body = await self.register()
        async with self.store.connection() as connection:
            await connection.execute("UPDATE sherpa_private.sessions SET expires_at = now() - interval '1 second' "
                                     "WHERE user_id = (SELECT id FROM sherpa_private.users WHERE email = $1)", email)
        self.assertEqual((await request(self.app, "/api/progress", method="GET", headers=auth))[0], 401)
        self.assertIsNone((await request(self.app, "/api/auth/session", method="GET", headers=auth))[2]["user"])
        # Do not run global maintenance here: staging may have unrelated
        # expired rows. Only this test's own account is removed below.
        async with self.store.connection() as connection:
            user_id = await connection.fetchval("DELETE FROM sherpa_private.users WHERE email = $1 RETURNING id", email)
            self.assertEqual(await connection.fetchval("SELECT count(*) FROM sherpa_private.sessions WHERE user_id = $1", user_id), 0)
            self.assertEqual(await connection.fetchval("SELECT count(*) FROM sherpa_private.progress WHERE user_id = $1", user_id), 0)