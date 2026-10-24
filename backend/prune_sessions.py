"""Delete at most 1000 expired sessions: python -m backend.prune_sessions."""

import asyncio
import os

from .database import PostgresAccountsStore


async def prune(dsn):
    store = PostgresAccountsStore(dsn)
    try:
        await store.start()
        return await store.prune_expired_sessions()
    finally:
        await store.close()


def main():
    dsn = os.environ.get("SHERPA_DATABASE_URL")
    if not dsn:
        raise SystemExit("SHERPA_DATABASE_URL is required; no database was changed.")
    try:
        count = asyncio.run(prune(dsn))
    except Exception:
        raise SystemExit("Session maintenance failed; check database availability.") from None
    print(f"Removed {count} expired sessions (maximum batch: 1000).")


if __name__ == "__main__":
    main()
