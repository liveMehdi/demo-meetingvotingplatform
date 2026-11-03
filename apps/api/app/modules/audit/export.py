"""Exporting audit history from the terminal for checking without changing the database"""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import Settings
from app.db.session import build_engine
from app.modules.audit.models import AuditChain
from app.modules.audit.proof import AuditExport
from app.modules.audit.service import build_export


async def read_snapshot(engine: AsyncEngine) -> AuditExport:
    async with engine.connect() as connection:
        connection = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with connection.begin():
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            async with AsyncSession(
                bind=connection, join_transaction_mode="create_savepoint"
            ) as session:
                head = await session.get(AuditChain, 1)
                return await build_export(session, head)


def write_export(path: Path, bundle: AuditExport) -> None:
    ## never overwrite an existing export or any other user file
    with path.open("x", encoding="utf-8") as destination:
        destination.write(bundle.model_dump_json())


async def run(path: Path) -> None:
    engine = build_engine(Settings().require_database_url())
    try:
        bundle = await read_snapshot(engine)
        write_export(path, bundle)
    finally:
        await engine.dispose()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Read only local-operator audit export using configured db credentials. "
            "The API can remain stopped."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="New file path, existing files are never overwritten.",
    )
    args = parser.parse_args(argv)
    try:
        asyncio.run(run(args.output))
    except FileExistsError:
        print("Output file already exists")
        return 1
    except Exception as exc:
        print(f"Export failed ({type(exc).__name__}).")
        return 1
    print("Audit export saved, independent checkpoint verification pending.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
