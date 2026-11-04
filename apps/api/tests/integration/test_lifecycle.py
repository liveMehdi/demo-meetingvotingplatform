import pytest
from sqlalchemy import select

from app.modules.ballots.invalidation import invalidate
from app.modules.ballots.models import Ballot
from app.modules.ballots.results_service import get_results
from app.modules.ballots.schemas import BallotOpen, InvalidateRequest, VoteSubmission
from app.modules.ballots.service import DraftConflict, close_ballot, open_ballot, publish_ballot
from app.modules.ballots.voting_service import VotingClosed, cast_vote
from app.modules.meetings import lifecycle_service as lifecycle
from app.modules.meetings.models import MeetingChange
from app.modules.meetings.schemas import MeetingTransition
from app.modules.meetings.service import MeetingConflict
from tests.helpers import call, vote_counts

pytestmark = pytest.mark.integration


async def test_meeting_cannot_end_with_open_votes_or_reopen_after_ending(db, people, opened):
    meeting, ballot = opened

    meeting = await call(
        db,
        lifecycle.transition,
        people["officer"],
        meeting.id,
        MeetingTransition(action="start", expected_revision=1),
    )

    preview = await call(db, lifecycle.completion, people["officer"], meeting.id)

    with pytest.raises(MeetingConflict, match="Close all open"):
        await call(
            db,
            lifecycle.transition,
            people["officer"],
            meeting.id,
            MeetingTransition(
                action="end",
                expected_revision=meeting.revision,
                preview_token=preview.preview_token,
            ),
        )

    await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

    with pytest.raises(MeetingConflict, match="activity changed"):
        await call(
            db,
            lifecycle.transition,
            people["officer"],
            meeting.id,
            MeetingTransition(
                action="end",
                expected_revision=meeting.revision,
                preview_token=preview.preview_token,
            ),
        )

    preview = await call(db, lifecycle.completion, people["officer"], meeting.id)

    ended = await call(
        db,
        lifecycle.transition,
        people["officer"],
        meeting.id,
        MeetingTransition(
            action="end", expected_revision=meeting.revision, preview_token=preview.preview_token
        ),
    )

    with pytest.raises(MeetingConflict):
        await call(
            db,
            lifecycle.transition,
            people["officer"],
            meeting.id,
            MeetingTransition(action="start", expected_revision=ended.revision),
        )

    # results from closed ballots can still be published after the meeting ends
    assert (await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)).state == (
        "PUBLISHED"
    )

    async with db() as session:
        assert list(
            await session.scalars(
                select(MeetingChange.kind)
                .where(MeetingChange.meeting_id == meeting.id)
                .order_by(MeetingChange.revision)
            )
        ) == (["created", "started", "ended"])


async def test_cancelling_meeting_requires_draft_confirmation(db, people, prepared):
    meeting, ballot = prepared
    preview = await call(db, lifecycle.completion, people["officer"], meeting.id)

    data = MeetingTransition(
        action="cancel", expected_revision=1, preview_token=preview.preview_token
    )

    with pytest.raises(MeetingConflict, match="Confirm cancellation"):
        await call(db, lifecycle.transition, people["officer"], meeting.id, data)

    cancelled = await call(
        db,
        lifecycle.transition,
        people["officer"],
        meeting.id,
        data.model_copy(update={"confirm_cancel_drafts": True}),
    )

    assert cancelled.state == "CANCELLED"

    async with db() as session:
        assert (await session.get(Ballot, ballot.id)).state == "CANCELLED"


async def test_ballot_cannot_publish_early_or_reopen(db, people, opened):
    meeting, ballot = opened
    with pytest.raises(DraftConflict):
        await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    closed = await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

    with pytest.raises(DraftConflict):
        await call(
            db,
            open_ballot,
            people["officer"],
            meeting.id,
            ballot.id,
            BallotOpen(expected_revision=closed.revision, expected_eligibility_revision=1),
        )


@pytest.mark.parametrize("published", [False, True])
async def test_invalidation_preserves_votes_and_published_results(db, people, opened, published):
    meeting, ballot = opened

    await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[0].id]),
    )
    if published:
        await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

        ballot = await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    reason = InvalidateRequest(
        expected_revision=ballot.revision, reason="Incorrect question", confirm=True
    )

    await call(db, invalidate, people["officer"], meeting.id, ballot.id, reason)
    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)

    with pytest.raises(VotingClosed):
        await call(
            db,
            cast_vote,
            people["absent"],
            ballot.id,
            VoteSubmission(option_ids=[ballot.options[1].id]),
        )

    if published:
        result = await call(db, get_results, people["member"], ballot.id)

        assert result.invalidation_reason == "Incorrect question"
        assert result.options[0].count == 1
    else:
        with pytest.raises(DraftConflict, match="invalidated"):
            await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)
