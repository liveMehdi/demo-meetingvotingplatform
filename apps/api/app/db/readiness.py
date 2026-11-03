"""Checking that the database version matches the app without changing anything."""

from functools import lru_cache

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import API_ROOT


@lru_cache(maxsize=1)
def expected_heads() -> frozenset[str]:
    config = Config(str(API_ROOT / "alembic.ini"))
    return frozenset(ScriptDirectory.from_config(config).get_heads())


async def schema_is_current(connection: AsyncConnection | AsyncSession) -> bool:
    if await connection.scalar(text("SELECT to_regclass('alembic_version')")) is None:
        return False
    actual = frozenset(await connection.scalars(text("SELECT version_num FROM alembic_version")))
    return actual == expected_heads()
