import asyncio

import pytest
from sqlalchemy import event, select

from app.modules.ballots.models import VoteChoice
from app.modules.ballots.schemas import VoteSubmission
from app.modules.ballots.service import close_ballot
from app.modules.ballots.voting_service import InvalidChoices, VotingClosed, cast_vote
from app.modules.meetings.models import Meeting
from tests.helpers import call, vote_counts, wait_for_lock_waiters

pytestmark = pytest.mark.integration


async def test_concurrent_duplicate_submissions_record_exactly_one_vote(db, people, opened):
    meeting, ballot = opened

    # locking the meeting while both requests start their database work
    async with db() as blocker, blocker.begin():
        await blocker.scalar(select(Meeting).where(Meeting.id == meeting.id).with_for_update())

        async with asyncio.TaskGroup() as group:
            first = group.create_task(
                call(
                    db,
                    cast_vote,
                    people["member"],
                    ballot.id,
                    VoteSubmission(option_ids=[ballot.options[0].id]),
                )
            )

            await wait_for_lock_waiters(db, 1)

            second = group.create_task(
                call(
                    db,
                    cast_vote,
                    people["member"],
                    ballot.id,
                    VoteSubmission(option_ids=[ballot.options[1].id]),
                )
            )

            await wait_for_lock_waiters(db, 2)

            await blocker.commit()

    assert sorted([first.result().already_submitted, second.result().already_submitted]) == [
        False,
        True,
    ]
    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)
    async with db() as session:
        original = await session.scalar(
            select(VoteChoice.option_id).where(VoteChoice.ballot_id == ballot.id)
        )

    await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

    receipt = await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[2].id]),
    )

    assert receipt.already_submitted is True
    assert receipt.model_dump() == {"submitted": True, "already_submitted": True}
    async with db() as session:
        assert (
            await session.scalar(
                select(VoteChoice.option_id).where(VoteChoice.ballot_id == ballot.id)
            )
            == original
        )

    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)


@pytest.mark.parametrize("first_operation", ["vote", "close"])
async def test_vote_racing_close_is_atomic(db, people, opened, first_operation):
    meeting, ballot = opened

    async def vote():
        try:
            await call(
                db,
                cast_vote,
                people["member"],
                ballot.id,
                VoteSubmission(option_ids=[ballot.options[0].id]),
            )
            return "recorded"
        except VotingClosed:
            return "closed"

    async def close():
        return await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

    operations = {"vote": vote, "close": close}
    second_operation = "close" if first_operation == "vote" else "vote"

    async with db() as blocker, blocker.begin():
        await blocker.scalar(select(Meeting).where(Meeting.id == meeting.id).with_for_update())
        async with asyncio.TaskGroup() as group:
            tasks = {first_operation: group.create_task(operations[first_operation]())}

            await wait_for_lock_waiters(db, 1)

            tasks[second_operation] = group.create_task(operations[second_operation]())

            await wait_for_lock_waiters(db, 2)

            await blocker.commit()

    assert tasks["close"].result().state == "CLOSED"
    expected = 1 if first_operation == "vote" else 0
    assert tasks["vote"].result() == ("recorded" if expected else "closed")
    assert await vote_counts(db, ballot.id) == (expected, expected, expected, 0)


async def test_failure_saving_choice_rolls_back_receipt_and_vote(db, people, opened):
    _, ballot = opened

    def fail_choice_write(_mapper, _connection, _target):
        raise RuntimeError("Injected choice write failure")

    event.listen(VoteChoice, "before_insert", fail_choice_write)

    try:
        with pytest.raises(RuntimeError, match="Injected choice write failure"):
            await call(
                db,
                cast_vote,
                people["member"],
                ballot.id,
                VoteSubmission(option_ids=[ballot.options[0].id]),
            )
    finally:
        event.remove(VoteChoice, "before_insert", fail_choice_write)
    assert await vote_counts(db, ballot.id) == (0, 0, 0, 0)

    receipt = await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[0].id]),
    )

    assert receipt.already_submitted is False
    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)


async def test_invalid_choice_does_not_consume_voting_right(db, people, opened):
    from uuid import uuid4
    _, ballot = opened

    with pytest.raises(InvalidChoices):
        await call(db, cast_vote, people["member"], ballot.id, VoteSubmission(option_ids=[uuid4()]))

    assert await vote_counts(db, ballot.id) == (0, 0, 0, 0)

    await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[0].id]),
    )

    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)
