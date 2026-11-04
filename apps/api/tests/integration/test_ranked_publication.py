import pytest
from sqlalchemy import select

from app.modules.ballots.models import RankedResult, VoteRanking
from app.modules.ballots.results_service import get_results
from app.modules.ballots.schemas import VoteSubmission
from app.modules.ballots.service import close_ballot, publish_ballot
from app.modules.ballots.voting_service import cast_vote
from tests.helpers import call, open_prepared, prepare_ballot, vote_counts

pytestmark = pytest.mark.integration


async def test_ranked_votes_store_order_and_publish_a_stable_result(db, people):
    meeting, ballot = await prepare_ballot(db, people["officer"], counting_method="irv_v1")

    ballot = await open_prepared(db, people["officer"], meeting, ballot)

    first, second, third = [o.id for o in ballot.options]

    await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[third, first, second]),
    )

    async with db() as session:
        rows = (
            await session.execute(
                select(VoteRanking.rank, VoteRanking.option_id)
                .where(VoteRanking.ballot_id == ballot.id)
                .order_by(VoteRanking.rank)
            )
        ).all()

    assert rows == [(1, third), (2, first), (3, second)]
    assert await vote_counts(db, ballot.id) == (1, 1, 0, 3)
    await call(db, close_ballot, people["officer"], meeting.id, ballot.id)
    await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    result = await call(db, get_results, people["member"], ballot.id)

    assert result.counting_method == "irv_v1"
    assert result.outcome == "winner"
    assert result.leading_option_ids == [third]
    assert result.rounds[0].counts == {first: 0, second: 0, third: 1}

    async with db() as session:
        saved = (await session.get(RankedResult, ballot.id)).payload

    await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    again = await call(db, get_results, people["member"], ballot.id)

    assert again == result

    async with db() as session:
        assert (await session.get(RankedResult, ballot.id)).payload == saved
