"""Explicit, transactional migrations: python -m backend.migrate.

SHERPA_MIGRATION_DATABASE_URL (or SHERPA_DATABASE_URL fallback) identifies the target. This command never
creates, drops, or resets databases. Migration contents are checksum-verified.
"""

import asyncio
import hashlib
import os
from pathlib import Path

from .database_connection import connection_options


async def migrate(dsn):
    import asyncpg

    connection = await asyncpg.connect(dsn, **connection_options(dsn))
    try:
        async with connection.transaction():
            # Migration 001 predates explicit schema qualification. Preserve its
            # checksum while ensuring ambient role/DSN search_path cannot redirect it.
            await connection.execute("SET LOCAL search_path = public")
            await connection.execute("SELECT pg_advisory_xact_lock(731984203)")
            await connection.execute(
                "CREATE TABLE IF NOT EXISTS public.sherpa_schema_migrations "
                "(version TEXT PRIMARY KEY, checksum TEXT NOT NULL, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            for path in sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql")):
                sql = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                existing = await connection.fetchval(
                    "SELECT checksum FROM public.sherpa_schema_migrations WHERE version = $1", path.name)
                if existing is not None:
                    if existing != checksum:
                        raise RuntimeError("Applied migration checksum does not match")
                    continue
                await connection.execute(sql)
                await connection.execute(
                    "INSERT INTO public.sherpa_schema_migrations (version, checksum) VALUES ($1, $2)",
                    path.name, checksum)
    finally:
        await connection.close(timeout=5)


def main():
    dsn = os.environ.get("SHERPA_MIGRATION_DATABASE_URL") or os.environ.get("SHERPA_DATABASE_URL")
    if not dsn:
        raise SystemExit("SHERPA_DATABASE_URL is required; no database was changed.")
    try:
        asyncio.run(migrate(dsn))
    except Exception:
        raise SystemExit("Database migration failed; check database configuration and migration state.") from None
    print("Database migrations are up to date.")


if __name__ == "__main__":
    main()