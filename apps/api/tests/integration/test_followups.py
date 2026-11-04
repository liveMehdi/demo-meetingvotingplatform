from uuid import uuid4

import pytest

from app.modules.ballots import followup_service
from app.modules.ballots.followup_schemas import FollowupCreate
from app.modules.ballots.invalidation import invalidate
from app.modules.ballots.schemas import InvalidateRequest, VoteSubmission
from app.modules.ballots.service import DraftConflict, close_ballot, publish_ballot
from app.modules.ballots.voting_service import cast_vote
from tests.helpers import call, open_prepared, vote_counts

pytestmark = pytest.mark.integration


async def test_runoff_copies_only_tied_candidates_without_votes(db, people, opened):
    meeting, ballot = opened

    for role, option in zip(["member", "absent"], ballot.options[:2], strict=True):
        await call(db, cast_vote, people[role], ballot.id, VoteSubmission(option_ids=[option.id]))

    await call(db, close_ballot, people["officer"], meeting.id, ballot.id)

    ballot = await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    data = FollowupCreate(
        kind="runoff",
        meeting_id=meeting.id,
        expected_revision=ballot.revision,
        expected_meeting_revision=meeting.revision,
    )

    key = uuid4()

    runoff = await call(db, followup_service.create, people["officer"], ballot.id, data, key)

    assert runoff.predecessor_id == ballot.id
    assert [o.label for o in runoff.options] == [o.label for o in ballot.options[:2]]
    assert not {o.id for o in runoff.options} & {o.id for o in ballot.options}
    assert runoff.counting_method == ballot.counting_method
    assert await vote_counts(db, runoff.id) == (0, 0, 0, 0)
    assert (
        await call(db, followup_service.create, people["officer"], ballot.id, data, key)
    ).id == (runoff.id)

    with pytest.raises(DraftConflict, match="already has a follow-up"):
        await call(db, followup_service.create, people["officer"], ballot.id, data, uuid4())

    await open_prepared(db, people["officer"], meeting, runoff)

    await call(
        db,
        cast_vote,
        people["member"],
        runoff.id,
        VoteSubmission(option_ids=[runoff.options[0].id]),
    )

    assert await vote_counts(db, ballot.id) == (2, 2, 2, 0)


async def test_replacement_requires_invalidated_source_and_keeps_history(db, people, opened):
    meeting, ballot = opened

    data = FollowupCreate(
        kind="replacement",
        meeting_id=meeting.id,
        expected_revision=ballot.revision,
        expected_meeting_revision=meeting.revision,
    )

    with pytest.raises(DraftConflict):
        await call(db, followup_service.create, people["officer"], ballot.id, data, uuid4())
    await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[0].id]),
    )

    await call(
        db,
        invalidate,
        people["officer"],
        meeting.id,
        ballot.id,
        InvalidateRequest(expected_revision=ballot.revision, reason="Wrong wording", confirm=True),
    )
    data = data.model_copy(update={"expected_revision": ballot.revision + 1})

    replacement = await call(
        db, followup_service.create, people["officer"], ballot.id, data, uuid4()
    )

    assert replacement.predecessor_id == ballot.id and replacement.state == "DRAFT"
    assert replacement.question == ballot.question
    assert [o.label for o in replacement.options] == [o.label for o in ballot.options]
    assert await vote_counts(db, replacement.id) == (0, 0, 0, 0)
    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)
