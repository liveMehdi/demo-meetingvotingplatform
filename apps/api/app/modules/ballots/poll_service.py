from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.ballots.models import (
    POLL_KINDS,
    Ballot,
    GuestParticipationReceipt,
    Option,
    Vote,
    VoteChoice,
)
from app.modules.ballots.schemas import (
    BallotResponse,
    GuestPoll,
    GuestPollsPage,
    OptionTotal,
    PollDraftInput,
    PollOpen,
    PollPresentation,
    PollResults,
    SubmissionReceipt,
    VoteSubmission,
)
from app.modules.ballots.service import BallotNotFound, DraftConflict, response
from app.modules.ballots.voting_service import VotingClosed, validate_choices
from app.modules.meetings.guest_service import require_admitted_guest
from app.modules.meetings.models import Meeting
from app.modules.meetings.service import check_officer, lock_meeting, require_active


def poll_scope(meeting_id: UUID):
    return select(Ballot).where(Ballot.meeting_id == meeting_id, Ballot.kind.in_(POLL_KINDS))


async def locked_poll(
    session: AsyncSession, meeting_id: UUID, ballot_id: UUID, *, read: bool = False
) -> Ballot:
    
    ballot = await session.scalar(
        poll_scope(meeting_id).where(Ballot.id == ballot_id).with_for_update(read=read)
    )

    if ballot is None:
        raise BallotNotFound
    return ballot


async def options_for(session: AsyncSession, ballot_id: UUID) -> list[Option]:

    return list(
        await session.scalars(
            select(Option).where(Option.ballot_id == ballot_id).order_by(Option.position)
        )
    )


def validate_poll_opening(ballot: Ballot, options: list[Option]) -> None:
    try:
        data = PollDraftInput(
            kind=ballot.kind,
            question=ballot.question,
            description=ballot.description,
            min_selections=ballot.min_selections,
            max_selections=ballot.max_selections,
            options=[option.label for option in options],
        )

    except ValidationError:
        raise DraftConflict("Fix the draft's poll settings before opening it.") from None
    
    if (
        data.question != ballot.question
        or data.description != ballot.description
        or data.options != [option.label for option in options]
        or [option.position for option in options] != list(range(len(options)))
        or any(option.code is not None for option in options)
    ):
        
        raise DraftConflict("Fix the draft's options before opening it.")


async def participation_count(session: AsyncSession, ballot_id: UUID) -> int:
    return await session.scalar(
        select(func.count())
        .select_from(GuestParticipationReceipt)
        .where(GuestParticipationReceipt.ballot_id == ballot_id)
    )


async def open_poll(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID, data: PollOpen
) -> BallotResponse:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id)
        ballot = await locked_poll(session, meeting_id, ballot_id)
        options = await options_for(session, ballot_id)
        if ballot.state == "OPEN" and ballot.revision == data.expected_revision + 1:
            return response(ballot, options, await participation_count(session, ballot_id))
        if ballot.state != "DRAFT" or ballot.revision != data.expected_revision:
            raise DraftConflict(
                "Review the latest draft before opening. Closed polls cannot reopen."
            )
        validate_poll_opening(ballot, options)
        ballot.state = "OPEN"
        ballot.revision += 1
        ballot.opened_at = datetime.now(UTC)
        ballot.opened_by = actor_id
        # polls dont snapshot membership and attendance or lock eligibility
        await record(session, AuditAction.BALLOT_OPENED, actor_id, ballot_id, meeting_id=meeting_id)
        await session.flush()
        return response(ballot, options)


async def close_poll(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID
) -> BallotResponse:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id)
        ballot = await locked_poll(session, meeting_id, ballot_id)
        if ballot.state not in {"OPEN", "CLOSED"}:
            raise DraftConflict("Only an open poll can be closed.")
        if ballot.state == "OPEN":
            ballot.state = "CLOSED"
            ballot.closed_at = datetime.now(UTC)
            ballot.revision += 1
            await record(
                session, AuditAction.BALLOT_CLOSED, actor_id, ballot_id, meeting_id=meeting_id
            )
        return response(
            ballot,
            await options_for(session, ballot_id),
            await participation_count(session, ballot_id),
        )


async def totals(session: AsyncSession, ballot: Ballot) -> PollResults:
    # Caller holds a shared or exclusive ballot lock, counts and state describe the same snapshot
    if ballot.state not in {"OPEN", "CLOSED"}:
        raise BallotNotFound
    counts = dict(
        (
            await session.execute(
                select(VoteChoice.option_id, func.count())
                .where(VoteChoice.ballot_id == ballot.id)
                .group_by(VoteChoice.option_id)
            )
        ).all()
    )
    return PollResults(
        invalidated_at=ballot.invalidated_at,
        invalidation_reason=ballot.invalidation_reason,
        ballot_id=ballot.id,
        state=ballot.state,
        participation_count=await participation_count(session, ballot.id),
        options=[
            OptionTotal(
                id=option.id,
                label=option.label,
                position=option.position,
                code=option.code,
                count=counts.get(option.id, 0),
            )
            for option in await options_for(session, ballot.id)
        ],
    )


async def officer_results(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID
) -> PollResults:
    async with session.begin():
        await check_officer(session, actor_id)
        return await totals(session, await locked_poll(session, meeting_id, ballot_id, read=True))


async def presentation(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID
) -> PollPresentation:
    
    async with session.begin():
        await check_officer(session, actor_id)
        ballot = await locked_poll(session, meeting_id, ballot_id, read=True)
        results = await totals(
            session, ballot
        )  

        meeting = await session.get(Meeting, meeting_id)
        return PollPresentation(
            **results.model_dump(),
            meeting_title=meeting.title,
            meeting_state=meeting.state,
            question=ballot.question,
            description=ballot.description,
            kind=ballot.kind,
            min_selections=ballot.min_selections,
            max_selections=ballot.max_selections,
        )


async def list_guest_polls(
    session: AsyncSession, token: str | None, meeting_id: UUID, offset: int, limit: int
) -> GuestPollsPage:
    
    async with session.begin():
        await require_admitted_guest(session, token, meeting_id)
        scope = poll_scope(meeting_id).where(Ballot.state.in_(("OPEN", "CLOSED")))
        count = await session.scalar(select(func.count()).select_from(scope.subquery()))
        
        ballots = list(
            await session.scalars(
                scope.order_by(Ballot.opened_at.desc(), Ballot.id)
                .offset(offset)
                .limit(limit)
                .with_for_update(read=True)
            )
        )

        guest = await require_admitted_guest(session, token, meeting_id)
        items = []
        
        for ballot in ballots:
            results = await totals(session, ballot)
            items.append(
                GuestPoll(
                    invalidated_at=ballot.invalidated_at,
                    invalidation_reason=ballot.invalidation_reason,
                    id=ballot.id,
                    question=ballot.question,
                    description=ballot.description,
                    kind=ballot.kind,
                    state=ballot.state,
                    min_selections=ballot.min_selections,
                    max_selections=ballot.max_selections,
                    options=results.options,
                    participation_count=results.participation_count,
                    submitted=await session.get(GuestParticipationReceipt, (ballot.id, guest.id))
                    is not None,
                )
            )

        return GuestPollsPage(items=items, total=count, offset=offset, limit=limit)


async def submit_response(
    session: AsyncSession,
    token: str | None,
    meeting_id: UUID,
    ballot_id: UUID,
    data: VoteSubmission,
) -> SubmissionReceipt:
    async with session.begin():

        await require_admitted_guest(session, token, meeting_id)
        meeting = await lock_meeting(session, meeting_id, active=False, read=True)
        ballot = await locked_poll(session, meeting_id, ballot_id)
        guest = await require_admitted_guest(session, token, meeting_id)
        if ballot.state not in {"OPEN", "CLOSED"}:
            raise BallotNotFound
        
        # Allowing retries after closing if already submitted without showing or comparing
        if await session.get(GuestParticipationReceipt, (ballot_id, guest.id)) is not None:
            return SubmissionReceipt(already_submitted=True)
        
        if ballot.state != "OPEN":
            raise VotingClosed
        
        require_active(meeting)

        await validate_choices(session, ballot, data.option_ids)
        session.add(GuestParticipationReceipt(ballot_id=ballot_id, guest_session_id=guest.id))
        vote = Vote(ballot_id=ballot_id)

        session.add(vote)
        await session.flush()

        session.add_all(
            [
                VoteChoice(
                    vote_id=vote.id,
                    ballot_id=ballot_id,
                    option_id=option_id,
                    selection_limit=ballot.max_selections,
                    selection_index=index,
                )
                # Indexes limit the number of choices, sorting avoids saving click order
                for index, option_id in enumerate(sorted(data.option_ids))
            ]
        )

        await session.flush()

    return SubmissionReceipt(already_submitted=False)
