from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.ballots.models import (
    FORMAL_KINDS,
    Ballot,
    BallotEligibility,
    Option,
    ParticipationReceipt,
    Vote,
    VoteChoice,
    VoteRanking,
)
from app.modules.ballots.schemas import (
    MemberBallot,
    MemberBallotsPage,
    OptionResponse,
    SubmissionReceipt,
    VoteSubmission,
)
from app.modules.meetings.models import Meeting
from app.modules.meetings.service import lock_meeting, require_active


class BallotUnavailable(Exception):
    pass


class VotingClosed(Exception):
    pass


class InvalidChoices(Exception):
    pass


async def validate_choices(session: AsyncSession, ballot: Ballot, submitted: list[UUID]) -> None:
    minimum = 1 if ballot.counting_method == "irv_v1" else ballot.min_selections
    maximum = 50 if ballot.counting_method == "irv_v1" else ballot.max_selections
    if len(set(submitted)) != len(submitted) or not minimum <= len(submitted) <= maximum:
        raise InvalidChoices
    
    valid = set(
        await session.scalars(
            select(Option.id).where(Option.ballot_id == ballot.id, Option.id.in_(submitted))
        )
    )

    if valid != set(submitted):
        raise InvalidChoices


async def cast_vote(
    session: AsyncSession, user_id: UUID, ballot_id: UUID, data: VoteSubmission
) -> SubmissionReceipt:
    async with session.begin():

        # locking the user first so voting and closing in separate tabs don't get stuck waiting
        # for each other.
        user = await session.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )

        if user is None or user.is_suspended:
            raise BallotUnavailable
        
        meeting_id = await session.scalar(select(Ballot.meeting_id).where(Ballot.id == ballot_id))

        if meeting_id is None:
            raise BallotUnavailable
        
        meeting = await lock_meeting(session, meeting_id, active=False, read=True)

        # using the same lock as closing the ballot
        ballot = await session.scalar(
            select(Ballot).where(Ballot.id == ballot_id).with_for_update()
        )

        if (
            ballot is None
            or ballot.kind not in FORMAL_KINDS
            or ballot.state == "DRAFT"
            or await session.get(BallotEligibility, (ballot_id, user_id)) is None
        ):
            
            raise BallotUnavailable
        # confirming an earlier submission on retry, without looking up their choices
        if await session.get(ParticipationReceipt, (ballot_id, user_id)) is not None:
            return SubmissionReceipt(already_submitted=True)
        
        if ballot.state != "OPEN":
            raise VotingClosed
        
        require_active(meeting)
        submitted = data.option_ids

        await validate_choices(session, ballot, submitted)
        # saving the receipt and vote together, without matching IDs or exact times to link them
        session.add(ParticipationReceipt(ballot_id=ballot_id, user_id=user_id))
        vote = Vote(ballot_id=ballot_id)
        session.add(vote)

        await session.flush()

        session.add_all(
            [
                VoteRanking(vote_id=vote.id, ballot_id=ballot_id, option_id=option_id, rank=rank)
                for rank, option_id in enumerate(submitted, 1)
            ]
            if ballot.counting_method == "irv_v1"
            else [
                VoteChoice(vote_id=vote.id, ballot_id=ballot_id, option_id=option_id)
                for option_id in submitted
            ]
        )

        await session.flush()

    return SubmissionReceipt(already_submitted=False)


async def member_response(
    session: AsyncSession, ballot: Ballot, title: str, user_id: UUID
) -> MemberBallot:
    options = await session.scalars(
        select(Option).where(Option.ballot_id == ballot.id).order_by(Option.position)
    )

    participated = await session.get(ParticipationReceipt, (ballot.id, user_id)) is not None
    count = await session.scalar(
        select(func.count())
        .select_from(ParticipationReceipt)
        .where(ParticipationReceipt.ballot_id == ballot.id)
    )

    return MemberBallot(
        invalidated_at=ballot.invalidated_at,
        invalidation_reason=ballot.invalidation_reason,
        id=ballot.id,
        meeting_title=title,
        question=ballot.question,
        description=ballot.description,
        kind=ballot.kind,
        counting_method=ballot.counting_method,
        state=ballot.state,
        options=[OptionResponse.model_validate(option) for option in options],
        submitted=participated,
        participation_count=count,
    )


def accessible_ballots(user_id: UUID):
    return (
        select(Ballot, Meeting.title)
        .join(Meeting, Meeting.id == Ballot.meeting_id)
        .join(BallotEligibility, BallotEligibility.ballot_id == Ballot.id)
        .where(
            BallotEligibility.user_id == user_id,
            Ballot.state != "DRAFT",
            Ballot.kind.in_(FORMAL_KINDS),
        )
    )


async def list_member_ballots(
    session: AsyncSession, user_id: UUID, offset: int, limit: int, *, view: str = "all"
) -> MemberBallotsPage:
    async with session.begin():
        statement = accessible_ballots(user_id)

        submitted = (
            select(ParticipationReceipt.ballot_id)
            .where(
                ParticipationReceipt.ballot_id == Ballot.id, ParticipationReceipt.user_id == user_id
            )
            .exists()
        )
        if view == "ready":
            statement = statement.where(Ballot.state == "OPEN", ~submitted)

        elif view == "submitted":
            statement = statement.where(submitted)

        elif view == "results":
            statement = statement.where(Ballot.state == "PUBLISHED")

        total = await session.scalar(select(func.count()).select_from(statement.subquery()))

        rows = (
            await session.execute(
                statement.order_by(Ballot.opened_at.desc(), Ballot.id)
                .offset(offset)
                .limit(limit)
                .with_for_update(read=True, of=Ballot)
            )
        ).all()

        return MemberBallotsPage(
            items=[
                await member_response(session, ballot, title, user_id) for ballot, title in rows
            ],
            total=total,
            offset=offset,
            limit=limit,
        )


async def get_member_ballot(session: AsyncSession, user_id: UUID, ballot_id: UUID) -> MemberBallot:
    async with session.begin():
        row = (
            await session.execute(
                accessible_ballots(user_id)
                .where(Ballot.id == ballot_id)
                .with_for_update(read=True, of=Ballot)
            )
        ).first()

        if row is None:
            raise BallotUnavailable
        
        return await member_response(session, row[0], row[1], user_id)
