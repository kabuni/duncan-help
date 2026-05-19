"""
Asyncpg connection pool — faster for raw SQL than SQLAlchemy ORM.
All route handlers use get_connection() as a dependency.
"""
import ssl
import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    _pool = await asyncpg.create_pool(
        host=settings.AZURE_PG_HOST,
        port=settings.AZURE_PG_PORT,
        database=settings.AZURE_PG_DATABASE,
        user=settings.AZURE_PG_USER,
        password=settings.AZURE_PG_PASSWORD,
        ssl=ssl_ctx if settings.AZURE_PG_SSL == "require" else None,
        min_size=2,
        max_size=20,
        command_timeout=60,
    )


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


async def get_connection() -> asyncpg.Connection:
    pool = get_pool()
    async with pool.acquire() as conn:
        yield conn
