import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.service import session_digest
from app.modules.meetings.guest_models import GuestAdmission, GuestSession
from app.modules.meetings.guest_schemas import (
    GuestJoiningStatus,
    GuestJoiningUpdate,
    GuestMeetingResponse,
)
from app.modules.meetings.models import Meeting
from app.modules.meetings.service import MeetingNotFound, check_officer, require_active


class JoiningConflict(Exception):
    pass


class GuestJoinUnavailable(Exception):
    pass


class GuestUnauthenticated(Exception):
    pass


def joining_status(meeting: Meeting) -> GuestJoiningStatus:
    return GuestJoiningStatus(
        enabled=meeting.guest_join_code is not None,
        code=meeting.guest_join_code,
        revision=meeting.guest_join_revision,
    )


async def get_joining(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID
) -> GuestJoiningStatus:
    async with session.begin():
        await check_officer(session, actor_id)
        meeting = await session.get(Meeting, meeting_id)

        if meeting is None:
            raise MeetingNotFound

        return joining_status(meeting)


def new_join_code() -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(10))


async def set_joining(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, change: GuestJoiningUpdate
) -> GuestJoiningStatus:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        meeting = await session.scalar(
            select(Meeting).where(Meeting.id == meeting_id).with_for_update()
        )

        if meeting is None:
            raise MeetingNotFound

        require_active(meeting)
        enabled = meeting.guest_join_code is not None

        if meeting.guest_join_revision != change.expected_revision:
            # returning the same join code when retrying a successful change
            if (
                enabled == change.enabled
                and meeting.guest_join_revision == change.expected_revision + 1
            ):
                return joining_status(meeting)

            raise JoiningConflict("Guest joining changed. Refresh before trying again.")

        if enabled == change.enabled:
            return joining_status(meeting)

        if change.enabled:
            for _ in range(3):
                try:

                    async with session.begin_nested():
                        meeting.guest_join_code = new_join_code()
                        await session.flush()

                    break

                except IntegrityError as exc:
                    if "uq_meetings_guest_join_code" not in str(exc.orig):
                        raise

                    await session.refresh(meeting)
            else:
                raise JoiningConflict("Could not create a join code. Try again.")
        else:
            meeting.guest_join_code = None

        meeting.guest_join_revision += 1
        await record(
            session,
            AuditAction.GUEST_JOINING_ENABLED
            if change.enabled

            else AuditAction.GUEST_JOINING_DISABLED,
            actor_id,
            meeting_id,

            meeting_id=meeting_id,
        )

        return joining_status(meeting)


def meeting_response(meeting: Meeting, guest: GuestSession) -> GuestMeetingResponse:
    return GuestMeetingResponse(
        meeting_id=meeting.id,
        title=meeting.title,
        state=meeting.state,

        scheduled_at=meeting.scheduled_at,
        session_expires_at=guest.expires_at,
    )


async def join_meeting(
    session: AsyncSession, code: str, token: str | None, ttl_seconds: int
) -> tuple[GuestMeetingResponse, str]:
    async with session.begin():
        # keeping the join code unchanged while admitting a guest, without needing an account
        meeting = await session.scalar(
            select(Meeting).where(Meeting.guest_join_code == code).with_for_update(read=True)
        )

        if meeting is None or meeting.state not in {"PLANNED", "LIVE"}:
            raise GuestJoinUnavailable

        digest = session_digest(token)
        guest = (
            await session.scalar(
                select(GuestSession).where(GuestSession.token_hash == digest).with_for_update()
            )

            if digest
            else None
        )

        now = datetime.now(UTC)

        if guest is None or guest.expires_at <= now:
            token = secrets.token_urlsafe(32)

            guest = GuestSession(
                token_hash=session_digest(token),
                created_at=now,
                expires_at=now + timedelta(seconds=ttl_seconds),
            )

            session.add(guest)
            await session.flush()

        # handling joins from the same browser one at a time
        if await session.get(GuestAdmission, (guest.id, meeting.id)) is None:
            session.add(GuestAdmission(guest_session_id=guest.id, meeting_id=meeting.id))

        return meeting_response(meeting, guest), token


async def get_guest_meeting(
    session: AsyncSession, token: str | None, meeting_id: UUID
) -> GuestMeetingResponse:
    async with session.begin():
        guest = await require_admitted_guest(session, token, meeting_id)
        
        meeting = await session.get(Meeting, meeting_id)

        return meeting_response(meeting, guest)


async def require_admitted_guest(
    session: AsyncSession, token: str | None, meeting_id: UUID
) -> GuestSession:
    """checking guest access in this transaction, including after waiting for a ballot lock"""
    digest = session_digest(token)

    if digest is None:
        raise GuestUnauthenticated

    guest = await session.scalar(
        select(GuestSession).where(
            GuestSession.token_hash == digest, GuestSession.expires_at > func.clock_timestamp()
        )
    )

    if guest is None:
        raise GuestUnauthenticated

    if await session.get(GuestAdmission, (guest.id, meeting_id)) is None:
        raise MeetingNotFound

    return guest
