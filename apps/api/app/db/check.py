"""Run from apps/api with: uv run --no-sync python -m app.db.check."""

import argparse
import asyncio

from sqlalchemy import text

from app.core.config import Settings
from app.db.readiness import schema_is_current
from app.db.session import build_engine


async def check_database(*, schema: bool = False) -> None:
    engine = build_engine(Settings().require_database_url())
    try:
        async with engine.connect() as connection:
            result = await connection.scalar(text("SELECT 1"))
            if result != 1:
                raise RuntimeError("Unexpected db response")
            if schema and not await schema_is_current(connection):
                print("Database connected, schema version mismatch")
                raise SystemExit(1)
        print("Database OK.")
        if schema:
            print("Schema up to date.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Check database connectivity and optionally migrations."
    )
    parser.add_argument(
        "--schema", action="store_true", help="Also require the current Alembic head."
    )
    args = parser.parse_args()
    try:
        asyncio.run(check_database(schema=args.schema))
    except Exception as exc:
        # credentials are kept out of errors
        print(f"Database check failed ({type(exc).__name__}).")
        raise SystemExit(1) from None
