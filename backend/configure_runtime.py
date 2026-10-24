"""One-time least-privilege runtime setup; all credentials remain private.

Run only for the selected app project: python -m backend.configure_runtime
The bootstrap fails closed if an unknown pre-existing server role exists.
"""

import asyncio
import json
import os
import secrets
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from dotenv import load_dotenv, set_key

from .database_connection import connection_options

ROOT = Path(__file__).resolve().parent.parent


async def configure():
    import asyncpg

    path = ROOT / ".env"
    load_dotenv(path, override=False, encoding="utf-8-sig")
    runtime = os.environ.get("SHERPA_DATABASE_URL")
    owner = os.environ.get("SHERPA_MIGRATION_DATABASE_URL") or runtime
    if not runtime or not owner:
        raise ValueError("Database configuration is required")
    admin = await asyncpg.connect(owner, **connection_options(owner))
    candidate = None
    created = False
    try:
        parsed = urlsplit(runtime)
        user = unquote(parsed.username or "")
        already_runtime = user == "sherpa_backend" or user.startswith("sherpa_backend.")
        if not already_runtime:
            if await admin.fetchval("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sherpa_backend')"):
                raise ValueError("Unknown existing runtime role; manual review required")
            await admin.execute((ROOT / "deploy" / "supabase-runtime-role.sql").read_text(encoding="utf-8"))
            created = True
            password = secrets.token_urlsafe(48)
            await admin.execute("SET password_encryption='scram-sha-256'")
            statement = await admin.fetchval(
                "SELECT format('ALTER ROLE sherpa_backend LOGIN CONNECTION LIMIT 5 PASSWORD %L', $1::text)", password)
            await admin.execute(statement)
            grant = await admin.fetchval("SELECT format('GRANT CONNECT ON DATABASE %I TO sherpa_backend', current_database())")
            await admin.execute(grant)
            new_user = "sherpa_backend"
            if (parsed.hostname or "").endswith(".pooler.supabase.com"):
                if "." not in user:
                    raise ValueError("Shared pooler username must include project reference")
                new_user += "." + user.split(".", 1)[1]
            hostpart = parsed.netloc.rsplit("@", 1)[-1]
            runtime = urlunsplit((parsed.scheme, quote(new_user, safe="") + ":" + quote(password, safe="") + "@" + hostpart,
                                 parsed.path, parsed.query, parsed.fragment))
        candidate = await asyncpg.connect(runtime, **connection_options(runtime))
        row = await candidate.fetchrow("SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user")
        assert row is not None and not any(row.values())
        assert await candidate.fetchval("SELECT current_user='sherpa_backend'")
        assert not await candidate.fetchval(
            "SELECT EXISTS(SELECT 1 FROM pg_auth_members WHERE member="
            "(SELECT oid FROM pg_roles WHERE rolname=current_user))")
        assert not await candidate.fetchval("SELECT has_schema_privilege(current_user,'sherpa_private','CREATE')")
        assert not await candidate.fetchval("SELECT has_table_privilege(current_user,'public.sherpa_schema_migrations','SELECT')")
        assert not await candidate.fetchval("SELECT has_table_privilege(current_user,'sherpa_private.users','DELETE')")
        for table in ("users", "sessions", "progress"):
            assert await candidate.fetchval("SELECT has_table_privilege(current_user,$1,'SELECT')", "sherpa_private." + table)
        await candidate.fetchval("SELECT count(*) FROM sherpa_private.users")
        # Persist only after the restricted role authenticates over verified TLS.
        set_key(str(path), "SHERPA_MIGRATION_DATABASE_URL", owner, quote_mode="always", encoding="utf-8-sig")
        set_key(str(path), "SHERPA_DATABASE_URL", runtime, quote_mode="always", encoding="utf-8-sig")
        result = {"status": "verified", "dedicated_runtime_role": True,
                  "separate_migration_owner": True, "rls_bypass": False,
                  "schema_create": False, "migration_ledger_read": False,
                  "user_delete": False, "other_role_memberships": False,
                  "configuration_saved_privately": True}
        output = ROOT / "verification" / "runtime-role.json"
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return result
    except BaseException:
        if created:
            try:
                await admin.execute("ALTER ROLE sherpa_backend NOLOGIN")
            except Exception:
                pass
        raise
    finally:
        if candidate is not None:
            await candidate.close(timeout=5)
        await admin.close(timeout=5)


def main():
    try:
        result = asyncio.run(configure())
    except Exception as error:
        print("RUNTIME_ROLE=" + json.dumps({"status": "failed", "error_type": type(error).__name__,
                                            "sqlstate": getattr(error, "sqlstate", None)}))
        raise SystemExit(1) from None
    print("RUNTIME_ROLE=" + json.dumps(result))


if __name__ == "__main__":
    main()