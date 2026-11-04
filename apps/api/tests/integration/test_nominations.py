import pytest

from app.modules.ballots.schemas import BallotOpen, DraftInput
from app.modules.ballots.service import DraftConflict, create_draft, open_ballot
from app.modules.nominations import service as nominations
from app.modules.nominations.schemas import (
    NominationCreate,
    NomineeDecision,
    OfficerDecision,
    WindowUpdate,
)
from tests.helpers import call

pytestmark = pytest.mark.integration


async def test_consent_approval_withdrawal_and_candidate_freezing(db, people, prepared):
    meeting, _ = prepared
    ballot = await call(
        db,
        create_draft,
        people["officer"],
        meeting.id,
        DraftInput(kind="election", question="Nominate a chair", candidate_source="nominations"),
    )

    await call(
        db,
        nominations.set_window,
        people["officer"],
        ballot.id,
        WindowUpdate(state="OPEN", expected_revision=1),
    )

    first = await call(
        db,
        nominations.create,
        people["member"],
        ballot.id,
        NominationCreate(nominee_email="nico@example.org", candidate_name="Shan"),
    )

    assert first.status == "PENDING_CONSENT"

    with pytest.raises(nominations.NominationConflict, match="consent"):
        await call(
            db,
            nominations.decide,
            people["officer"],
            ballot.id,
            first.id,
            OfficerDecision(action="approve", expected_revision=first.revision),
        )

    with pytest.raises(nominations.NominationDenied):
        await call(
            db,
            nominations.decide,
            people["member"],
            ballot.id,
            first.id,
            NomineeDecision(action="accept", candidate_name="Shan", expected_revision=1),
        )

    first = await call(
        db,
        nominations.decide,
        people["absent"],
        ballot.id,
        first.id,
        NomineeDecision(action="accept", candidate_name="Shan", expected_revision=1),
    )

    first = await call(
        db,
        nominations.decide,
        people["officer"],
        ballot.id,
        first.id,
        OfficerDecision(action="approve", expected_revision=first.revision),
    )

    own = await call(
        db,
        nominations.create,
        people["member"],
        ballot.id,
        NominationCreate(nominee_email="jonny@example.org", candidate_name="Tyrone"),
    )

    assert own.status == "PENDING_REVIEW"

    own = await call(
        db,
        nominations.decide,
        people["officer"],
        ballot.id,
        own.id,
        OfficerDecision(action="approve", expected_revision=own.revision),
    )

    from app.modules.ballots.models import Ballot

    async with db() as session:
        revision = (await session.get(Ballot, ballot.id)).revision

    with pytest.raises(DraftConflict, match="Close nominations"):
        await call(
            db,
            open_ballot,
            people["officer"],
            meeting.id,
            ballot.id,
            BallotOpen(expected_revision=revision, expected_eligibility_revision=1),
        )

    closed = await call(
        db,
        nominations.set_window,
        people["officer"],
        ballot.id,
        WindowUpdate(state="CLOSED", expected_revision=revision),
    )

    opened = await call(
        db,
        open_ballot,
        people["officer"],
        meeting.id,
        ballot.id,
        BallotOpen(expected_revision=closed["revision"], expected_eligibility_revision=1),
    )

    assert {o.label for o in opened.options} == {"Tyrone", "Shan"}

    with pytest.raises(nominations.NominationConflict, match="after voting opens"):
        await call(
            db,
            nominations.decide,
            people["member"],
            ballot.id,
            own.id,
            NomineeDecision(action="withdraw", expected_revision=own.revision),
        )


async def test_withdrawn_nomination_cannot_be_approved_or_resubmitted(db, people, prepared):
    meeting, _ = prepared

    ballot = await call(
        db,
        create_draft,
        people["officer"],
        meeting.id,
        DraftInput(kind="election", question="Nominate", candidate_source="nominations"),
    )
    await call(
        db,
        nominations.set_window,
        people["officer"],
        ballot.id,
        WindowUpdate(state="OPEN", expected_revision=1),
    )

    nomination = await call(
        db,
        nominations.create,
        people["member"],
        ballot.id,
        NominationCreate(nominee_email="jonny@example.org", candidate_name="Tyrone"),
    )
    withdrawn = await call(
        db,
        nominations.decide,
        people["member"],
        ballot.id,
        nomination.id,
        NomineeDecision(action="withdraw", expected_revision=1),
    )

    with pytest.raises(nominations.NominationConflict, match="final"):
        await call(
            db,
            nominations.decide,
            people["officer"],
            ballot.id,
            nomination.id,
            OfficerDecision(action="approve", expected_revision=withdrawn.revision),
        )

    retry = await call(
        db,
        nominations.create,
        people["member"],
        ballot.id,
        NominationCreate(nominee_email="jonny@example.org", candidate_name="Changed"),
    )

    assert retry.id == withdrawn.id and retry.status == "WITHDRAWN"
