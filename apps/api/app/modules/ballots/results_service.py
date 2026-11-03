from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ballots.models import (
    FORMAL_KINDS,
    Ballot,
    BallotEligibility,
    Option,
    RankedResult,
    VoteChoice,
)
from app.modules.ballots.schemas import OptionTotal, PublishedResults
from app.modules.ballots.service import BallotNotFound, DraftConflict
from app.modules.meetings.service import check_officer


def outcome(kind: str, options: list[OptionTotal]) -> tuple[str, list[UUID]]:
    if kind == "motion":
        counts = {option.code: option.count for option in options}
        return ("passed" if counts["for"] > counts["against"] else "failed"), []
    
    highest = max(option.count for option in options)

    if highest == 0:
        return "no_votes", []
    leaders = [option.id for option in options if option.count == highest]

    return ("winner" if len(leaders) == 1 else "runoff"), leaders


async def get_results(
    session: AsyncSession, actor_id: UUID, ballot_id: UUID, *, meeting_id: UUID | None = None
) -> PublishedResults:
    async with session.begin():

        # check current officer access, or the member list saved when voting opened.
        if meeting_id is not None:
            await check_officer(session, actor_id)
        statement = select(Ballot).where(Ballot.id == ballot_id, Ballot.kind.in_(FORMAL_KINDS))

        if meeting_id is not None:
            statement = statement.where(Ballot.meeting_id == meeting_id)
        ballot = await session.scalar(statement.with_for_update(read=True))

        if ballot is None or (
            meeting_id is None
            and await session.get(BallotEligibility, (ballot_id, actor_id)) is None
        ):
            
            raise BallotNotFound
        # only counting and returning results once published.

        if ballot.state != "PUBLISHED":
            raise DraftConflict("Results have not been published.")
        
        if ballot.counting_method == "irv_v1":
            saved = await session.get(RankedResult, ballot_id)
            if saved is None:
                raise DraftConflict("Published ranked results are unavailable.")
            return PublishedResults.model_validate(saved.payload).model_copy(
                update={
                    "invalidated_at": ballot.invalidated_at,
                    "invalidation_reason": ballot.invalidation_reason,
                }
            )
        
        rows = (
            await session.execute(
                select(Option, func.count(VoteChoice.vote_id))
                .outerjoin(
                    VoteChoice,
                    (VoteChoice.option_id == Option.id)
                    & (VoteChoice.ballot_id == Option.ballot_id),
                )
                .where(Option.ballot_id == ballot_id)
                .group_by(Option.id)
                .order_by(Option.position)
            )
        ).all()

        totals = [
            OptionTotal(
                id=option.id,
                label=option.label,
                position=option.position,
                code=option.code,
                count=count,
            )
            for option, count in rows
        ]

        result, leaders = outcome(ballot.kind, totals)

        return PublishedResults(
            invalidated_at=ballot.invalidated_at,
            invalidation_reason=ballot.invalidation_reason,
            ballot_id=ballot.id,
            kind=ballot.kind,
            published_at=ballot.published_at,
            options=totals,
            participation_count=sum(option.count for option in totals),
            eligible_count=ballot.eligible_count,
            eligible_attendance_count=ballot.eligible_attendance_count,
            outcome=result,
            leading_option_ids=leaders,
        )
