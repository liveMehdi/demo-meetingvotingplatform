from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ballots.models import (
    Ballot,
    Option,
    ParticipationReceipt,
    RankedResult,
    Vote,
    VoteRanking,
)
from app.modules.ballots.ranked import count_irv
from app.modules.ballots.schemas import OptionTotal, PublishedResults


async def save_result(session: AsyncSession, ballot: Ballot) -> None:
    """Only when publishing with the ballot locked and not when viewing results"""
    options = list(
        await session.scalars(
            select(Option).where(Option.ballot_id == ballot.id).order_by(Option.position)
        )
    )

    votes = list(await session.scalars(select(Vote.id).where(Vote.ballot_id == ballot.id)))
    receipts = await session.scalar(
        select(func.count())
        .select_from(ParticipationReceipt)
        .where(ParticipationReceipt.ballot_id == ballot.id)
    )

    if receipts != len(votes):
        raise ValueError("Participation and vote counts differ")
    
    by_vote = {vote_id: [] for vote_id in votes}

    rows = await session.stream(
        select(VoteRanking.vote_id, VoteRanking.rank, VoteRanking.option_id)
        .where(VoteRanking.ballot_id == ballot.id)
        .order_by(VoteRanking.vote_id, VoteRanking.rank)
    )

    async for row in rows:
        ranking = by_vote[row.vote_id]
        if row.rank != len(ranking) + 1:
            raise ValueError("Noncontiguous ranks")
        
        ranking.append(row.option_id)

    rankings = list(by_vote.values())
    outcome, leaders, rounds = count_irv([o.id for o in options], rankings)

    first = rounds[0].counts if rounds else {}

    result = PublishedResults(
        ballot_id=ballot.id,
        kind="election",
        published_at=ballot.published_at,

        options=[
            OptionTotal(
                id=o.id, label=o.label, position=o.position, code=o.code, count=first.get(o.id, 0)
            )
            for o in options
        ],

        participation_count=receipts,
        eligible_count=ballot.eligible_count,
        eligible_attendance_count=ballot.eligible_attendance_count,
        outcome=outcome,
        leading_option_ids=leaders,
        counting_method="irv_v1",
        rounds=rounds,
    )

    session.add(RankedResult(ballot_id=ballot.id, payload=result.model_dump(mode="json")))
    await session.flush()
