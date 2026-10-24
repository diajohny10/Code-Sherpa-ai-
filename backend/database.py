"""Optional PostgreSQL persistence. Account writes never use a local fallback."""

import asyncio
import json
from contextlib import asynccontextmanager
from uuid import uuid4

from .database_connection import connection_options


class DatabaseUnavailable(RuntimeError):
    pass


class DuplicateEmail(RuntimeError):
    pass


class RevisionConflict(RuntimeError):
    pass


class PostgresAccountsStore:
    def __init__(self, dsn):
        self._dsn = dsn
        self._pool = None

    async def start(self):
        try:
            import asyncpg

            self._pool = await asyncpg.create_pool(
                dsn=self._dsn, min_size=1, max_size=5,
                **connection_options(self._dsn),
            )
        except Exception:
            raise DatabaseUnavailable() from None

    async def close(self):
        pool, self._pool = self._pool, None
        if pool is not None:
            try:
                async with asyncio.timeout(5):
                    await pool.close()
            except Exception:
                pool.terminate()

    @asynccontextmanager
    async def connection(self):
        if self._pool is None:
            raise DatabaseUnavailable()
        try:
            async with self._pool.acquire(timeout=5) as connection:
                yield connection
        except (DuplicateEmail, RevisionConflict):
            raise
        except Exception:
            raise DatabaseUnavailable() from None

    async def find_user(self, email):
        async with self.connection() as connection:
            row = await connection.fetchrow(
                "SELECT id, email, password_hash FROM sherpa_private.users WHERE email = $1", email)
            return dict(row) if row else None

    async def register(self, email, password_hash, token_hash, expires_at,
                       previous_hash, progress):
        import asyncpg

        async with self.connection() as connection:
            async with connection.transaction():
                user_id = uuid4()
                try:
                    await connection.execute(
                        "INSERT INTO sherpa_private.users (id, email, password_hash) VALUES ($1, $2, $3)",
                        user_id, email, password_hash)
                except asyncpg.UniqueViolationError:
                    raise DuplicateEmail() from None
                await connection.execute(
                    "INSERT INTO sherpa_private.progress (user_id, payload) VALUES ($1, $2::jsonb)",
                    user_id, json.dumps(progress))
                await self._rotate(connection, user_id, token_hash, expires_at, previous_hash)
                return {"id": str(user_id), "email": email}, progress, 0

    async def _rotate(self, connection, user_id, token_hash, expires_at, previous_hash):
        await connection.execute(
            "DELETE FROM sherpa_private.sessions WHERE token_hash = $1", previous_hash)
        await connection.execute(
            "INSERT INTO sherpa_private.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
            token_hash, user_id, expires_at)

    async def login(self, user_id, token_hash, expires_at, previous_hash):
        async with self.connection() as connection:
            async with connection.transaction():
                await self._rotate(connection, user_id, token_hash, expires_at, previous_hash)
                row = await connection.fetchrow(
                    "SELECT users.id, users.email, progress.payload, progress.revision "
                    "FROM sherpa_private.users JOIN sherpa_private.progress "
                    "ON progress.user_id = users.id WHERE users.id = $1",
                    user_id)
                return self._snapshot(row)

    @staticmethod
    def _snapshot(row):
        if row is None:
            return None
        payload = row["payload"]
        return ({"id": str(row["id"]), "email": row["email"]},
                json.loads(payload) if isinstance(payload, str) else payload, row["revision"])

    async def session(self, token_hash):
        async with self.connection() as connection:
            row = await connection.fetchrow(
                "SELECT users.id, users.email, progress.payload, progress.revision "
                "FROM sherpa_private.sessions JOIN sherpa_private.users ON users.id = sessions.user_id "
                "JOIN sherpa_private.progress ON progress.user_id = users.id "
                "WHERE sessions.token_hash = $1 AND sessions.expires_at > now()", token_hash)
            return self._snapshot(row)

    async def logout(self, token_hash):
        async with self.connection() as connection:
            await connection.execute("DELETE FROM sherpa_private.sessions WHERE token_hash = $1", token_hash)

    async def prune_expired_sessions(self, batch_size=1000):
        """Bound maintenance work; never prune all sessions during sign-in."""
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 1000:
            raise ValueError("batch_size must be between 1 and 1000")
        async with self.connection() as connection:
            return await connection.fetchval(
                "WITH expired AS (SELECT token_hash FROM sherpa_private.sessions WHERE expires_at <= now() "
                "ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED), "
                "deleted AS (DELETE FROM sherpa_private.sessions WHERE token_hash IN "
                "(SELECT token_hash FROM expired) RETURNING 1) SELECT count(*) FROM deleted",
                batch_size)

    async def save_progress(self, token_hash, progress, revision):
        async with self.connection() as connection:
            row = await connection.fetchrow(
                "UPDATE sherpa_private.progress SET payload = $2::jsonb, revision = revision + 1 "
                "WHERE user_id = (SELECT user_id FROM sherpa_private.sessions "
                "WHERE token_hash = $1 AND expires_at > now()) AND revision = $3 "
                "RETURNING payload, revision", token_hash, json.dumps(progress), revision)
            if row is None:
                if not await connection.fetchval(
                        "SELECT 1 FROM sherpa_private.sessions WHERE token_hash = $1 AND expires_at > now()",
                        token_hash):
                    return None
                raise RevisionConflict()
            return progress, row["revision"]