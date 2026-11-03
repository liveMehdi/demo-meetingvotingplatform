"""Marking ballots as invalid while keeping their original results."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.ballots.models import Ballot
from app.modules.ballots.schemas import InvalidateRequest
from app.modules.ballots.service import BallotNotFound, DraftConflict
from app.modules.meetings.service import check_officer, lock_meeting


async def invalidate(
    session: AsyncSession,
    actor_id: UUID,
    meeting_id: UUID,
    ballot_id: UUID,
    data: InvalidateRequest,
):
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id, active=False)

        ballot = await session.scalar(
            select(Ballot)
            .where(Ballot.id == ballot_id, Ballot.meeting_id == meeting_id)
            .with_for_update()
        )
        if ballot is None:
            raise BallotNotFound

        if ballot.invalidated_at:
            if (
                ballot.revision == data.expected_revision + 1
                and ballot.invalidation_reason == data.reason
            ):
                return
            raise DraftConflict("This ballot is already invalidated. The reason cannot be changed.")

        if (
            ballot.revision != data.expected_revision
            or ballot.opened_at is None
            or ballot.state not in {"OPEN", "CLOSED", "PUBLISHED"}
        ):
            raise DraftConflict(
                "Only opened ballots can be invalidated. Refresh and review the ballot."
            )

        now = await session.scalar(select(func.clock_timestamp()))
        if ballot.state == "OPEN":
            ballot.state = "CLOSED"
            ballot.closed_at = now

        ballot.invalidated_at = now
        ballot.invalidated_by = actor_id
        ballot.invalidation_reason = data.reason
        ballot.revision += 1

        await record(
            session, AuditAction.BALLOT_INVALIDATED, actor_id, ballot_id, meeting_id=meeting_id
        )
