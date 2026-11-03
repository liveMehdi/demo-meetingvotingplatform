from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.auth.models import Session, User
from app.modules.auth.service import session_digest
from app.modules.meetings.guest_service import GuestUnauthenticated, require_admitted_guest
from app.modules.meetings.models import Meeting
from app.modules.meetings.service import MeetingNotFound
from app.modules.realtime.manager import Audience


class AccessDenied(Exception):
    pass


async def check_access(
    factory: async_sessionmaker[AsyncSession],
    audience: Audience,
    token: str | None,
    meeting_id: UUID,
) -> datetime:
    """Using a new short database session for each check"""
    async with factory() as session, session.begin():
        if audience == "guest":
            try:
                guest = await require_admitted_guest(session, token, meeting_id)
            except (GuestUnauthenticated, MeetingNotFound):
                raise AccessDenied from None
            return guest.expires_at
        
        digest = session_digest(token)
        if digest is None:
            raise AccessDenied
        
        expires_at = await session.scalar(
            select(Session.expires_at)
            .join(User, User.id == Session.user_id)
            .where(
                Session.token_hash == digest,
                Session.expires_at > func.clock_timestamp(),
                User.is_officer.is_(True),
                User.is_suspended.is_(False),
            )
        )

        if expires_at is None or await session.get(Meeting, meeting_id) is None:
            raise AccessDenied
        
        return expires_at
