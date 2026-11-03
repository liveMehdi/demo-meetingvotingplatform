from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import creation_requests
from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.models import User
from app.modules.meetings.models import Meeting, MeetingChange
from app.modules.meetings.schemas import (
    EligibilitySettingUpdate,
    MeetingCreate,
    MeetingResponse,
    MeetingsPage,
)


class OfficerRequired(Exception):
    pass


class MeetingNotFound(Exception):
    pass

class EligibilitySettingConflict(Exception):
    pass


class MeetingConflict(Exception):
    pass


def require_active(meeting: Meeting) -> None:
    if meeting.state not in {"PLANNED", "LIVE"}:
        raise MeetingConflict("This meeting has ended or been cancelled and is read-only.")


async def lock_meeting(
    session: AsyncSession, meeting_id: UUID, *, active=True, read=False
) -> Meeting:
    meeting = await session.scalar(
        select(Meeting)
        .where(Meeting.id == meeting_id)
        .with_for_update(read=read)
        .execution_options(populate_existing=True)
    )

    if meeting is None:
        raise MeetingNotFound
    if active:
        require_active(meeting)

    return meeting


def remember_change(session: AsyncSession, meeting: Meeting, actor_id: UUID, kind: str) -> None:
    session.add(
        MeetingChange(
            meeting_id=meeting.id,
            revision=meeting.revision,
            title=meeting.title,
            description=meeting.description,
            scheduled_at=meeting.scheduled_at,
            state=meeting.state,
            recorded_by=actor_id,
            kind=kind,
        )
    )


async def update_eligibility_setting(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, data: EligibilitySettingUpdate
) -> MeetingResponse:
    async with session.begin():
        await lock_electorate(session)
        await check_officer(session, actor_id, lock=True)
        
        meeting = await session.scalar(
            select(Meeting).where(Meeting.id == meeting_id).with_for_update()
        )

        if meeting is None:
            raise MeetingNotFound

        require_active(meeting)

        if meeting.eligibility_locked_at is not None:
            raise EligibilitySettingConflict(
                "Eligibility settings are locked after the first ballot opens."
            )

        if meeting.eligibility_revision != data.expected_revision:
            raise EligibilitySettingConflict(
                "The eligibility setting changed. Refresh before saving."
            )

        if meeting.eligibility_policy != data.eligibility_policy:
            meeting.eligibility_policy = data.eligibility_policy
            meeting.eligibility_revision += 1

            await record(
                session,
                AuditAction.ELIGIBILITY_ALL
                if data.eligibility_policy == "all_approved"
                else AuditAction.ELIGIBILITY_ATTENDING,

                actor_id,
                meeting_id,
                meeting_id=meeting_id,
            )

        result = MeetingResponse.model_validate(meeting)

    return result


async def check_officer(session: AsyncSession, actor_id: UUID, *, lock: bool = False) -> None:
    statement = select(User.is_officer).where(User.id == actor_id, User.is_suspended.is_(False))

    if lock:
        # preventing officer access from changing while this action runs
        statement = statement.with_for_update()

    if not await session.scalar(statement):
        raise OfficerRequired


async def create_meeting(
    session: AsyncSession, actor_id: UUID, data: MeetingCreate, key: UUID | None = None
) -> MeetingResponse:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        digest = creation_requests.fingerprint(data)
        recovered = await creation_requests.recover(session, actor_id, key, "meeting", digest)

        if recovered is not None:
            return MeetingResponse.model_validate(
                await lock_meeting(session, recovered, active=False)
            )

        meeting = Meeting(
            title=data.title,
            description=data.description,
            scheduled_at=data.scheduled_at,
            created_by=actor_id,
        )

        session.add(meeting)
        await session.flush()

        remember_change(session, meeting, actor_id, "created")
        creation_requests.remember(session, actor_id, key, "meeting", digest, meeting.id)
        await record(
            session, AuditAction.MEETING_CREATED, actor_id, meeting.id, meeting_id=meeting.id
        )
        result = MeetingResponse.model_validate(meeting)

    return result


async def list_meetings(
    session: AsyncSession,
    actor_id: UUID,
    offset: int,
    limit: int,
    *,
    view: str = "all",
    q: str = "",
) -> MeetingsPage:
    async with session.begin():
        await check_officer(session, actor_id)
        statement = select(Meeting)

        if view == "upcoming":
            statement = statement.where(Meeting.scheduled_at >= func.now())
        elif view == "past":

            statement = statement.where(Meeting.scheduled_at < func.now())
        elif view in {"planned", "live", "ended", "cancelled"}:
            statement = statement.where(Meeting.state == view.upper())

        if q.strip():
            statement = statement.where(
                func.lower(Meeting.title).contains(q.strip().lower(), autoescape=True)
            )

        total = await session.scalar(select(func.count()).select_from(statement.subquery()))
        meetings = await session.scalars(
            statement.order_by(
                Meeting.scheduled_at.asc() if view == "upcoming" else Meeting.scheduled_at.desc(),
                Meeting.id,
            )
            .offset(offset)
            .limit(limit)
        )

        return MeetingsPage(
            items=[MeetingResponse.model_validate(meeting) for meeting in meetings],
            total=total,
            offset=offset,
            limit=limit,
        )


async def get_meeting(session: AsyncSession, actor_id: UUID, meeting_id: UUID) -> MeetingResponse:
    async with session.begin():
        await check_officer(session, actor_id)
        meeting = await session.get(Meeting, meeting_id)

        if meeting is None:
            raise MeetingNotFound

        return MeetingResponse.model_validate(meeting)
