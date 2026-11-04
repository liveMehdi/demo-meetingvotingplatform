"""Separate database areas for backend and browser tests"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

API_ROOT = Path(__file__).resolve().parents[1]


def migrate(connection, revision="head"):
    config = Config(str(API_ROOT / "alembic.ini"))

    config.attributes["connection"] = connection

    command.upgrade(config, revision)


@asynccontextmanager
async def isolated_database(revision="head"):
    value = os.environ.get("TEST_DATABASE_URL")

    if not value:
        raise ValueError(
            "Set TEST_DATABASE_URL to a dedicated database ending in _test. "
            "For database-free tests, run pytest -m 'not integration'."
        )
    try:
        url = make_url(value)

        valid = (
            url.drivername == "postgresql+asyncpg"
            and url.database
            and url.database.endswith("_test")
            and not url.query
        )
    except Exception:
        valid = False

    if not valid:
        raise ValueError(
            "TEST_DATABASE_URL must use postgresql+asyncpg, a database ending "
            "in _test, and no query parameters."
        )

    schema = "test_" + uuid4().hex

    control = create_async_engine(url, poolclass=NullPool, hide_parameters=True)

    engine = create_async_engine(
        url,
        poolclass=NullPool,
        hide_parameters=True,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": schema,
                "statement_timeout": "15000",
                "lock_timeout": "12000",
            }
        },
    )

    created = False

    try:
        async with control.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        created = True

        async with engine.begin() as connection:
            await connection.run_sync(migrate, revision)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()

        try:
            if created:
                async with control.begin() as connection:
                    await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        finally:
            await control.dispose()
