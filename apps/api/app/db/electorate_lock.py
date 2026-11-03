"""Keep membership and attendance from changing while ballot eligibility is saved."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_electorate(session: AsyncSession) -> None:
    await session.execute(text("SELECT pg_advisory_xact_lock(17012026, 1)"))
