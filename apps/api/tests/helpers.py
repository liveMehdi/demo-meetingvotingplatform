import asyncio
from datetime import UTC, datetime
from time import monotonic

from sqlalchemy import func, select, text

from app.modules.ballots.models import ParticipationReceipt, Vote, VoteChoice, VoteRanking
from app.modules.ballots.schemas import BallotOpen, DraftInput
from app.modules.ballots.service import create_draft, open_ballot
from app.modules.meetings.schemas import MeetingCreate
from app.modules.meetings.service import create_meeting


async def call(factory, function, *args, **kwargs):
    """giving each call its own database connection and transaction"""

    async with factory() as session:
        return await function(session, *args, **kwargs)


async def prepare_ballot(factory, officer, *, counting_method="standard"):
    meeting = await call(
        factory,
        create_meeting,
        officer,
        MeetingCreate(title="Test meeting", scheduled_at=datetime.now(UTC)),
    )

    ballot = await call(
        factory,
        create_draft,
        officer,
        meeting.id,
        DraftInput(
            kind="election",
            question="Choose a chair",
            options=["Tyrone", "Shan", "Jonny"],
            counting_method=counting_method,
        ),
    )

    return meeting, ballot


async def open_prepared(factory, officer, meeting, ballot):
    return await call(
        factory,
        open_ballot,
        officer,
        meeting.id,
        ballot.id,
        BallotOpen(
            expected_revision=ballot.revision,
            expected_eligibility_revision=meeting.eligibility_revision,
        ),
    )


async def vote_counts(factory, ballot_id):
    async with factory() as session:
        return tuple(
            [
                await session.scalar(
                    select(func.count()).select_from(model).where(model.ballot_id == ballot_id)
                )
                for model in (ParticipationReceipt, Vote, VoteChoice, VoteRanking)
            ]
        )


async def wait_for_lock_waiters(factory, count):
    """waiting until the requests are blocked by a database lock"""

    deadline = monotonic() + 10
    async with factory() as session:
        while monotonic() < deadline:
            waiting = await session.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE application_name = current_setting('application_name') "
                    "AND cardinality(pg_blocking_pids(pid)) > 0"
                )
            )

            if waiting >= count:
                return
            # starting a fresh check so we see which requests are still waiting
            await session.rollback()

            await asyncio.sleep(0.01)

    raise AssertionError(f"Expected {count} concurrent PostgreSQL lock waiters")
