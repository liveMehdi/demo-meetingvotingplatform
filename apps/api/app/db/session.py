from collections.abc import AsyncIterator

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine


def build_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        echo=False,
        hide_parameters=True,
        connect_args={"timeout": 5},
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Giving each request a database session, services handle transactions."""
    factory = request.app.state.session_factory
    if factory is None:
        raise HTTPException(
            status_code=503, detail="Service unavailable. Contact admin."
        )
    async with factory() as session:
        yield session
