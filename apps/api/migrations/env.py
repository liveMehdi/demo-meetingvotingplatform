import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.db import creation_requests  # noqa: F401
from app.db.base import Base
from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.ballots import models as ballot_models  # noqa: F401
from app.modules.meetings import guest_models  # noqa: F401
from app.modules.meetings import models as meeting_models  # noqa: F401
from app.modules.members import models as member_models  # noqa: F401
from app.modules.nominations import models as nomination_models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# importing all models above so alembic can compare them with the database
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=Settings().require_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(
        Settings().require_database_url(),
        poolclass=pool.NullPool,
        echo=False,
        hide_parameters=True,
        connect_args={"timeout": 5},
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
elif config.attributes.get("connection") is not None:
    # using the test's transaction so table and data changes can be undone together
    do_run_migrations(config.attributes["connection"])
else:
    asyncio.run(run_migrations_online())
