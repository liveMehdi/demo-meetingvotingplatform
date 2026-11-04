import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.modules.ballots.models import Ballot
from app.modules.ballots.poll_service import open_poll, submit_response, totals
from app.modules.ballots.schemas import PollDraftInput, PollOpen, VoteSubmission
from app.modules.ballots.service import create_draft
from app.modules.ballots.voting_service import InvalidChoices
from app.modules.meetings.guest_models import GuestSession
from app.modules.meetings.guest_schemas import GuestJoiningUpdate
from app.modules.meetings.guest_service import (
    GuestUnauthenticated,
    join_meeting,
    set_joining,
)
from tests.helpers import call

pytestmark = pytest.mark.integration


@pytest.fixture
async def guest_poll(db, people, prepared):
    meeting, _ = prepared

    joining = await call(
        db,
        set_joining,
        people["officer"],
        meeting.id,
        GuestJoiningUpdate(enabled=True, expected_revision=1),
    )

    _, token = await call(db, join_meeting, joining.code, None, 3600)
    poll = await call(
        db,
        create_draft,
        people["officer"],
        meeting.id,
        PollDraftInput(
            kind="poll_multiple",
            question="Pick two",
            options=["A", "B", "C"],
            min_selections=2,
            max_selections=2,
        ),
    )

    poll = await call(
        db, open_poll, people["officer"], meeting.id, poll.id, PollOpen(expected_revision=1)
    )

    return meeting, poll, token


async def test_guest_selection_limits_and_duplicate_response(db, guest_poll):
    meeting, poll, token = guest_poll
    ids = [o.id for o in poll.options]

    for choices in ([ids[0]], ids, [ids[0], ids[0]]):
        with pytest.raises(InvalidChoices):
            await call(
                db, submit_response, token, meeting.id, poll.id, VoteSubmission(option_ids=choices)
            )

    results = await asyncio.gather(
        *[
            call(
                db, submit_response, token, meeting.id, poll.id, VoteSubmission(option_ids=ids[:2])
            )
            for _ in range(2)
        ]
    )

    assert sorted(r.already_submitted for r in results) == [False, True]
    async with db() as session, session.begin():
        result = await totals(session, await session.get(Ballot, poll.id))

    assert result.participation_count == 1
    assert [o.count for o in result.options] == [1, 1, 0]


async def test_expired_guest_session_cannot_respond(db, guest_poll):
    meeting, poll, token = guest_poll

    async with db() as session, session.begin():
        # the creation time must be before the expiry time
        await session.execute(
            update(GuestSession).values(
                created_at=datetime.now(UTC) - timedelta(hours=2),
                expires_at=datetime.now(UTC) - timedelta(hours=1),
            )
        )

    with pytest.raises(GuestUnauthenticated):
        await call(
            db,
            submit_response,
            token,
            meeting.id,
            poll.id,
            VoteSubmission(option_ids=[o.id for o in poll.options[:2]]),
        )
