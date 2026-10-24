import contextlib
import io
import ssl
import unittest
from unittest.mock import AsyncMock, patch

from backend.database_connection import connection_options
from backend.migrate import main, migrate


class ConnectionOptionsTests(unittest.TestCase):
    def test_hosted_connections_verify_certificate_and_hostname(self):
        for host in ("db.example.supabase.co", "aws-0-example.pooler.supabase.com", "localhost.evil.example"):
            with self.subTest(host=host), patch.dict("os.environ", {}, clear=True):
                options = connection_options(f"postgresql://user:fake-password@{host}:5432/postgres")
                self.assertIsInstance(options["ssl"], ssl.SSLContext)
                self.assertTrue(options["ssl"].check_hostname)
                self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)
                self.assertEqual(options["statement_cache_size"], 0)

    def test_weaker_encrypted_dsn_option_cannot_disable_certificate_checks(self):
        with patch.dict("os.environ", {}, clear=True):
            options = connection_options("postgresql://user:fake@example.com/postgres?sslmode=require")
        self.assertTrue(options["ssl"].check_hostname)
        self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)

    def test_hosted_plaintext_fallback_is_rejected_without_echoing_credentials(self):
        for mode in ("disable", "allow", "prefer", "wrong", "disable&sslmode=require"):
            with self.subTest(mode=mode), self.assertRaises(ValueError) as error:
                connection_options(f"postgresql://user:secret-password@example.com/postgres?sslmode={mode}")
            self.assertNotIn("secret-password", str(error.exception))

    def test_only_loopback_can_use_unencrypted_development_connections(self):
        for host in ("localhost", "127.0.0.1", "[::1]"):
            options = connection_options(f"postgresql://user:fake@{host}/sherpa_test")
            self.assertIs(options["ssl"], False)

    def test_unsupported_certificate_options_are_rejected_instead_of_ignored(self):
        for option in ("sslrootcert", "sslcrl", "sslcrldir", "sslcert", "sslkey", "sslpassword"):
            with self.subTest(option=option), self.assertRaises(ValueError):
                connection_options(f"postgresql://user:fake@example.com/postgres?{option}=certificate")

    def test_supabase_certificate_extends_trust_without_disabling_verification(self):
        with patch.dict("os.environ", {"SHERPA_DATABASE_CA_FILE": "root-certificate.crt"}, clear=True):
            with patch("backend.database_connection.ssl.create_default_context") as create:
                options = connection_options("postgresql://user:fake@example.com/postgres")
                create.return_value.load_verify_locations.assert_called_once_with(cafile="root-certificate.crt")
                self.assertTrue(options["ssl"].check_hostname)
                self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)

    def test_invalid_urls_are_sanitized(self):
        for dsn in ("secret", "http://user:secret@example.com/db", "postgresql:///db", "postgresql://localhost", "postgresql://localhost:bad/db"):
            with self.subTest(kind=dsn.split(":", 1)[0]), self.assertRaises(ValueError) as error:
                connection_options(dsn)
            self.assertNotIn(dsn, str(error.exception))

    def test_password_reserved_characters_must_be_percent_encoded(self):
        for dsn in ("postgresql://user:fake@password@example.com/postgres",
                    "postgresql://user:fake@example.com/postgres#fragment"):
            with self.assertRaises(ValueError):
                connection_options(dsn)
        with patch.dict("os.environ", {}, clear=True):
            self.assertTrue(connection_options(
                "postgresql://user:fake%40password@example.com/postgres"
            )["ssl"].check_hostname)

    def test_migration_cli_prefers_private_owner_url(self):
        with patch.dict("os.environ", {
            "SHERPA_DATABASE_URL": "runtime-secret-url",
            "SHERPA_MIGRATION_DATABASE_URL": "migration-secret-url",
        }, clear=True):
            with patch("backend.migrate.migrate", new=AsyncMock()) as operation:
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    main()
                operation.assert_awaited_once_with("migration-secret-url")
                self.assertNotIn("secret", output.getvalue())


class MigrationConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_migration_pins_schema_before_running_sql_with_nondefault_ambient_path(self):
        connection = AsyncMock()
        connection.fetchval.return_value = "already-applied"
        @contextlib.asynccontextmanager
        async def transaction():
            yield

        connection.transaction = transaction
        with patch("asyncpg.connect", new=AsyncMock(return_value=connection)):
            with patch("backend.migrate.Path.glob", return_value=[]):
                await migrate("postgresql://user:fake@localhost/test?search_path=other")
        self.assertEqual(connection.execute.call_args_list[0].args, ("SET LOCAL search_path = public",))
        connection.close.assert_awaited_once()

    async def test_migrator_uses_same_verified_transport_as_runtime(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("asyncpg.connect", new=AsyncMock(side_effect=RuntimeError("test-stop"))) as connect:
                with self.assertRaisesRegex(RuntimeError, "test-stop"):
                    await migrate("postgresql://user:fake@example.com/postgres")
                options = connect.call_args.kwargs
                self.assertTrue(options["ssl"].check_hostname)
                self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)
                self.assertEqual(options["statement_cache_size"], 0)