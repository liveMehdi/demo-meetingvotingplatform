import pytest

from app.modules.auth.recovery import manage_account
from app.modules.ballots.schemas import VoteSubmission
from app.modules.ballots.service import close_ballot, publish_ballot
from app.modules.ballots.voting_service import cast_vote
from app.modules.meetings.guest_schemas import GuestJoiningUpdate
from app.modules.meetings.guest_service import set_joining
from app.modules.members.schemas import SecurityUpdate
from tests.helpers import call, vote_counts

pytestmark = pytest.mark.integration


async def test_member_and_admin_cannot_perform_officer_actions(
    client,
    sign_in,
    opened,
):
    meeting, ballot = opened

    path = f"/api/meetings/{meeting.id}/ballots/{ballot.id}/close"

    for role in ("member", "admin"):
        await sign_in(role)
        assert (await client.post(path)).status_code == 403

    await sign_in("officer")

    # officers cannot manage accounts or read the audit history
    assert (await client.get("/api/members")).status_code == 403
    assert (await client.get("/api/audit/export")).status_code == 403
    assert (await client.post(path)).status_code == 200


async def test_unauthenticated_and_guest_cannot_cast_formal_votes(db, people, client, opened):
    meeting, ballot = opened

    path = f"/api/ballots/{ballot.id}/votes"
    body = {"option_ids": [str(ballot.options[0].id)]}
    assert (await client.post(path, json=body)).status_code == 401

    joining = await call(
        db,
        set_joining,
        people["officer"],
        meeting.id,
        GuestJoiningUpdate(enabled=True, expected_revision=1),
    )

    assert (await client.post("/api/guest/join", json={"code": joining.code})).status_code == 200
    assert (await client.get(f"/api/guest/meetings/{meeting.id}")).status_code == 200
    assert (await client.post(path, json=body)).status_code == 401
    assert (
        await client.post(
            f"/api/meetings/{meeting.id}/ballots/{ballot.id}/close",
        )
    ).status_code == 401
    assert await vote_counts(db, ballot.id) == (0, 0, 0, 0)


async def test_expired_and_suspended_sessions_cannot_vote(db, people, client, sign_in, opened):
    _, ballot = opened

    path = f"/api/ballots/{ballot.id}/votes"

    body = {"option_ids": [str(ballot.options[0].id)]}
    await sign_in("member", expired=True)
    assert (await client.post(path, json=body)).status_code == 401
    await sign_in("member")
    assert (await client.get("/api/auth/me")).status_code == 200

    await call(
        db,
        manage_account,
        people["admin"],
        people["member"],
        SecurityUpdate(action="suspend", expected_revision=1),
    )

    assert (await client.post(path, json=body)).status_code == 401
    assert await vote_counts(db, ballot.id) == (0, 0, 0, 0)


async def test_csrf_checks_apply_to_authenticated_voting(db, client, sign_in, opened):
    _, ballot = opened

    await sign_in("member")
    path = f"/api/ballots/{ballot.id}/votes"
    body = {"option_ids": [str(ballot.options[0].id)]}

    assert (
        await client.post(path, json=body, headers={"Origin": "https://untrusted.example"})
    ).status_code == 403
    assert (
        await client.post(path, json=body, headers={"X-CSRF-Protection": ""})
    ).status_code == 403
    assert await vote_counts(db, ballot.id) == (0, 0, 0, 0)

    response = await client.post(path, json=body)

    assert response.status_code == 200
    assert response.json() == {"submitted": True, "already_submitted": False}


async def test_results_require_explicit_publication_and_eligible_access(
    db,
    people,
    client,
    sign_in,
    opened,
):
    meeting, ballot = opened

    await call(
        db,
        cast_vote,
        people["member"],
        ballot.id,
        VoteSubmission(option_ids=[ballot.options[0].id]),
    )

    member_path = f"/api/ballots/{ballot.id}/results"

    officer_path = f"/api/meetings/{meeting.id}/ballots/{ballot.id}/results"

    for role, path in (("member", member_path), ("officer", officer_path)):
        await sign_in(role)

        assert (await client.get(path)).status_code == 409
        assert (await client.get(path + ".csv")).status_code == 409

    await call(db, close_ballot, people["officer"], meeting.id, ballot.id)
    await sign_in("member")
    assert (await client.get(member_path)).status_code == 409

    await call(db, publish_ballot, people["officer"], meeting.id, ballot.id)

    result = await client.get(member_path)

    assert result.status_code == 200
    assert result.json()["outcome"] == "winner"
    assert result.json()["participation_count"] == 1
    assert [o["count"] for o in result.json()["options"]] == [1, 0, 0]
    assert (await client.get(member_path + ".csv")).status_code == 200

    await sign_in("pending")

    assert (await client.get(member_path)).status_code == 404
    assert (await client.get(member_path + ".csv")).status_code == 404
