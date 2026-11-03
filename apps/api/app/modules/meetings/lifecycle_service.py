"""managing meetings for officers, taking the audit lock last"""

import hashlib
import json
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.ballots.models import FORMAL_KINDS, POLL_KINDS, Ballot
from app.modules.meetings.models import Attendance, Meeting, MeetingChange
from app.modules.meetings.schemas import (
    CompletionSummary,
    MeetingChangeResponse,
    MeetingHistory,
    MeetingResponse,
    MeetingTransition,
    MeetingUpdate,
)
from app.modules.meetings.service import (
    MeetingConflict,
    check_officer,
    lock_meeting,
    remember_change,
)
from app.modules.members.models import Membership, MembershipStatus


def summary(meeting: Meeting, ballots: list[Ballot]) -> CompletionSummary:
    # checking for changes since the preview, without receipts, voter details or choices

    payload = [
        meeting.revision,
        meeting.guest_join_revision,
        meeting.eligibility_revision,
        [(str(b.id), b.revision, b.state, b.nomination_state) for b in ballots],
    ]

    token = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()

    return CompletionSummary(
        open_formal=sum(b.state == "OPEN" and b.kind in FORMAL_KINDS for b in ballots),
        open_polls=sum(b.state == "OPEN" and b.kind in POLL_KINDS for b in ballots),
        drafts=sum(b.state == "DRAFT" for b in ballots),
        nomination_windows=sum(
            b.state == "DRAFT" and b.nomination_state == "OPEN" for b in ballots
        ),

        unpublished_results=sum(
            b.state == "CLOSED" and b.kind in FORMAL_KINDS and b.invalidated_at is None
            for b in ballots
        ),

        ever_opened=any(b.opened_at is not None for b in ballots),
        preview_token=token,
    )


async def locked_ballots(session: AsyncSession, meeting_id: UUID) -> list[Ballot]:
    return list(
        await session.scalars(
            select(Ballot)
            .where(Ballot.meeting_id == meeting_id)
            .order_by(Ballot.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )


async def completion(session: AsyncSession, actor_id: UUID, meeting_id: UUID):
    async with session.begin():
        await check_officer(session, actor_id)
        meeting = await lock_meeting(session, meeting_id, active=False, read=True)
        ballots = await locked_ballots(session, meeting_id)

        return summary(meeting, ballots)


async def update_details(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, data: MeetingUpdate
):
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        meeting = await lock_meeting(session, meeting_id)

        if meeting.revision != data.expected_revision:
            raise MeetingConflict("Meeting details changed. Reload before saving.")

        if meeting.state != "PLANNED" and data.scheduled_at != meeting.scheduled_at:
            raise MeetingConflict("Only planned meetings can be rescheduled.")

        if (meeting.title, meeting.description, meeting.scheduled_at) != (
            data.title,
            data.description,
            data.scheduled_at,
        ):
            meeting.title, meeting.description, meeting.scheduled_at = (
                data.title,
                data.description,
                data.scheduled_at,
            )

            meeting.revision += 1
            remember_change(session, meeting, actor_id, "edited")
            await record(
                session, AuditAction.MEETING_UPDATED, actor_id, meeting_id, meeting_id=meeting_id
            )

        return MeetingResponse.model_validate(meeting)


def cancel_draft(ballot: Ballot) -> None:
    ballot.state = "CANCELLED"
    ballot.revision += 1

    if ballot.candidate_source == "nominations" and ballot.nomination_state == "OPEN":
        ballot.nomination_state = "CLOSED"


async def transition(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, data: MeetingTransition
):
    async with session.begin():
        # keeping membership and attendance unchanged while saving the final summary
        await lock_electorate(session)
        await check_officer(session, actor_id, lock=True)

        meeting = await lock_meeting(session, meeting_id, active=False)
        target = {"start": "LIVE", "end": "ENDED", "cancel": "CANCELLED"}[data.action]

        if meeting.state == target and meeting.revision == data.expected_revision + 1:
            return MeetingResponse.model_validate(meeting)

        if meeting.revision != data.expected_revision:
            raise MeetingConflict("This meeting changed. Review it again.")

        if (meeting.state, target) not in {
            ("PLANNED", "LIVE"),
            ("LIVE", "ENDED"),
            ("PLANNED", "CANCELLED"),
        }:
            
            raise MeetingConflict("This action is not available for the meeting's current status.")

        ballots = await locked_ballots(session, meeting_id)
        actions = []

        if data.action != "start":
            preview = summary(meeting, ballots)

            if data.preview_token != preview.preview_token:
                raise MeetingConflict(
                    "Meeting activity changed. Review the completion summary again."
                )

            if preview.open_formal or preview.open_polls:
                raise MeetingConflict("Close all open formal votes and polls before proceeding.")

            if data.action == "cancel" and preview.ever_opened:
                raise MeetingConflict(
                    "A vote or poll has already opened. Start and end the meeting "
                    "instead; history cannot be cancelled."
                )

            if preview.drafts and not data.confirm_cancel_drafts:
                raise MeetingConflict(
                    "Confirm cancellation of all remaining drafts and their nominations."
                )

            for ballot in ballots:
                if ballot.state == "DRAFT":
                    cancel_draft(ballot)
                    actions.append((AuditAction.BALLOT_CANCELLED, ballot.id))

            if meeting.guest_join_code is not None:
                meeting.guest_join_code = None
                meeting.guest_join_revision += 1
                actions.append((AuditAction.GUEST_JOINING_DISABLED, meeting_id))

        now = await session.scalar(select(func.clock_timestamp()))

        if data.action == "end":
            counts = (
                await session.execute(
                    select(
                        func.count(),
                        func.count().filter(Membership.status == MembershipStatus.APPROVED),
                    )
                    .select_from(Attendance)
                    .join(Membership, Membership.user_id == Attendance.user_id)
                    .where(Attendance.meeting_id == meeting_id, Attendance.present.is_(True))
                )
            ).one()

            meeting.final_present_count, meeting.final_approved_present_count = counts

        setattr(
            meeting,
            {"start": "started_at", "end": "ended_at", "cancel": "cancelled_at"}[data.action],
            now,
        )

        meeting.state = target
        meeting.needs_status_review = False
        meeting.revision += 1
        kind = {"start": "started", "end": "ended", "cancel": "cancelled"}[data.action]
        remember_change(session, meeting, actor_id, kind)
        actions.append(
            (
                {
                    "start": AuditAction.MEETING_STARTED,
                    "end": AuditAction.MEETING_ENDED,
                    "cancel": AuditAction.MEETING_CANCELLED,
                }[data.action],
                meeting_id,
            )
        )

        await session.flush()

        # recording audit entries last, with no more app changes or locks afterwards
        for action, target_id in actions:
            await record(session, action, actor_id, target_id, meeting_id=meeting_id)

        return MeetingResponse.model_validate(meeting)


async def withdraw_draft(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID, revision: int
):
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id)
        ballot = await session.scalar(
            select(Ballot)
            .where(Ballot.id == ballot_id, Ballot.meeting_id == meeting_id)
            .with_for_update()
        )

        if ballot is None:
            raise MeetingConflict("Draft not found in this meeting.")

        if ballot.state == "CANCELLED" and ballot.revision == revision + 1:
            return
        if ballot.state != "DRAFT" or ballot.opened_at is not None or ballot.revision != revision:
            raise MeetingConflict(
                "Only an unchanged, unopened draft can be withdrawn. Refresh and review it."
            )

        cancel_draft(ballot)
        await record(
            session, AuditAction.BALLOT_CANCELLED, actor_id, ballot_id, meeting_id=meeting_id
        )


async def history(session: AsyncSession, actor_id: UUID, meeting_id: UUID, offset: int, limit: int):
    async with session.begin():
        await check_officer(session, actor_id)
        await lock_meeting(session, meeting_id, active=False, read=True)
        scope = MeetingChange.meeting_id == meeting_id
        total = await session.scalar(select(func.count()).select_from(MeetingChange).where(scope))
        rows = await session.scalars(
            select(MeetingChange)
            .where(scope)
            .order_by(MeetingChange.revision.desc())
            .offset(offset)
            .limit(limit)
        )

        return MeetingHistory(
            items=[MeetingChangeResponse.model_validate(row) for row in rows],
            total=total,
            offset=offset,
            limit=limit,
        )
