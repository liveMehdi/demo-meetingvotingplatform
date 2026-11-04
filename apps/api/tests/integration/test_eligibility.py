import pytest
from sqlalchemy import select

from app.modules.ballots.models import BallotEligibility
from app.modules.ballots.schemas import VoteSubmission
from app.modules.ballots.voting_service import BallotUnavailable, cast_vote
from app.modules.meetings.attendance_service import set_attendance
from app.modules.meetings.schemas import AttendanceUpdate, EligibilitySettingUpdate
from app.modules.meetings.service import update_eligibility_setting
from app.modules.members.schemas import MembershipUpdate
from app.modules.members.service import update_membership
from tests.helpers import call, open_prepared, vote_counts

pytestmark = pytest.mark.integration


async def test_attendance_and_membership_snapshot_stays_fixed(db, people, prepared):
    meeting, ballot = prepared

    meeting = await call(
        db,
        update_eligibility_setting,
        people["officer"],
        meeting.id,
        EligibilitySettingUpdate(eligibility_policy="attending_approved", expected_revision=1),
    )

    await call(
        db,
        set_attendance,
        people["officer"],
        meeting.id,
        people["member"],
        AttendanceUpdate(present=True, expected_revision=0),
    )

    ballot = await open_prepared(db, people["officer"], meeting, ballot)

    assert ballot.eligible_count == ballot.eligible_attendance_count == 1

    await call(
        db,
        set_attendance,
        people["officer"],
        meeting.id,
        people["member"],
        AttendanceUpdate(present=False, expected_revision=1),
    )
    await call(
        db,
        set_attendance,
        people["officer"],
        meeting.id,
        people["absent"],
        AttendanceUpdate(present=True, expected_revision=0),
    )

    await call(
        db, update_membership, people["admin"], people["member"], MembershipUpdate(status="revoked")
    )

    await call(
        db,
        update_membership,
        people["admin"],
        people["pending"],
        MembershipUpdate(status="approved"),
    )
    await call(
        db,
        set_attendance,
        people["officer"],
        meeting.id,
        people["pending"],
        AttendanceUpdate(present=True, expected_revision=0),
    )

    async with db() as session:
        rows = (
            await session.execute(
                select(BallotEligibility.user_id, BallotEligibility.attended_at_open).where(
                    BallotEligibility.ballot_id == ballot.id
                )
            )
        ).all()

    assert rows == [(people["member"], True)]
    submission = VoteSubmission(option_ids=[ballot.options[0].id])
    for role in ("absent", "pending"):
        with pytest.raises(BallotUnavailable):
            await call(db, cast_vote, people[role], ballot.id, submission)

    # removing membership affects future ballots, while suspension is handled separately
    await call(db, cast_vote, people["member"], ballot.id, submission)

    assert await vote_counts(db, ballot.id) == (1, 1, 1, 0)


async def test_all_approved_policy_includes_absent_members_but_not_pending(db, people, opened):
    _, ballot = opened

    assert ballot.eligible_count == 2
    assert ballot.eligible_attendance_count == 0

    async with db() as session:
        eligible = set(
            await session.scalars(
                select(BallotEligibility.user_id).where(BallotEligibility.ballot_id == ballot.id)
            )
        )

    assert eligible == {people["member"], people["absent"]}
