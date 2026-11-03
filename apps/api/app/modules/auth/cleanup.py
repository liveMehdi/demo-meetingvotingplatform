"""Manual cleanup, keeping voting receipts and guest records"""

import argparse
import asyncio

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import build_engine
from app.modules.auth.models import PasswordReset, Session


async def cleanup_expired(session: AsyncSession, *, apply: bool = False) -> dict[str, int]:
    async with session.begin():
        counts = {}

        for name, model in (("sessions", Session), ("reset_codes", PasswordReset)):

            predicate = model.expires_at <= func.now()
            if apply:
                result = await session.execute(delete(model).where(predicate))
                counts[name] = result.rowcount

            else:
                counts[name] = await session.scalar(
                    select(func.count()).select_from(model).where(predicate)
                )

        return counts


async def run(apply: bool) -> dict[str, int]:
    engine = build_engine(Settings().require_database_url())
    try:
        async with async_sessionmaker(engine)() as session:
            return await cleanup_expired(session, apply=apply)
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Delete expired account sessions and reset codes."
    )
    args = parser.parse_args()
    try:
        counts = asyncio.run(run(args.apply))
    except Exception as exc:
        print(f"Session cleanup failed ({type(exc).__name__}).")
        return 1
    
    action = "deleted" if args.apply else "eligible for deletion"

    print(f"Expired account sessions {action}: {counts['sessions']}")
    print(f"Expired recovery codes {action}: {counts['reset_codes']}")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
