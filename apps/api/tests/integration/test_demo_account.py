import pytest
from sqlalchemy import func, select

from app.modules.audit.models import AuditEvent
from app.modules.auth.models import PasswordReset, Session, User
from app.modules.auth.recovery import manage_account
from app.modules.auth.service import session_digest
from app.modules.members.models import Membership, MembershipStatus
from app.modules.members.schemas import SecurityUpdate
from tests.helpers import call

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("actor", ["admin", "officer"])
async def test_demo_account_cannot_be_locked_out(app, client, db, people, sign_in, actor):
    app.state.settings.demo_admin_email = "tyrone@example.org"

    async with db() as session, session.begin():
        demo = await session.get(User, people["admin"])
        demo.is_officer = True
        (await session.get(Membership, demo.id)).status = MembershipStatus.APPROVED
        (await session.get(User, people["officer"])).is_admin = True

    token = await sign_in(actor)

    async with db() as session:
        audit_count = await session.scalar(select(func.count()).select_from(AuditEvent))

    base = f"/api/members/{people['admin']}"

    for action in ("suspend", "remove_admin", "issue_reset", "revoke_sessions"):
        response = await client.post(
            base + "/security", json={"action": action, "expected_revision": 1}
        )

        assert response.status_code == 403
        assert "demo admin" in response.json()["detail"]

    for route, body in (
        ("membership", {"status": "revoked"}),
        ("officer", {"is_officer": False}),
    ):
        response = await client.patch(base + "/" + route, json=body)

        assert response.status_code == 403

    members = (await client.get("/api/members")).json()["items"]
    protected = next(member for member in members if member["id"] == str(people["admin"]))

    assert protected["is_demo_account"] is True

    async with db() as session:
        demo = await session.get(User, people["admin"])

        assert demo.is_admin and demo.is_officer and not demo.is_suspended
        assert demo.password_hash == "unused-in-session-tests"
        assert demo.security_revision == 1
        assert (await session.get(Membership, demo.id)).status == MembershipStatus.APPROVED
        assert await session.get(Session, session_digest(token)) is not None
        assert await session.scalar(select(func.count()).select_from(PasswordReset)) == 0
        assert await session.scalar(select(func.count()).select_from(AuditEvent)) == audit_count


async def test_demo_protection_blocks_a_previously_issued_reset(app, client, db, people):
    reset = await call(
        db, manage_account, people["admin"], people["admin"],
        SecurityUpdate(action="issue_reset", expected_revision=1),
    )

    app.state.settings.demo_admin_email = "tyrone@example.org"

    response = await client.post(
        "/api/auth/reset-password",
        json={"code": reset["reset_code"], "password": "purpleblue4112"},
    )

    assert response.status_code == 403

    async with db() as session:
        assert (await session.get(User, people["admin"])).password_hash == "unused-in-session-tests"


async def test_demo_admin_can_still_manage_other_accounts(app, client, people, sign_in):
    app.state.settings.demo_admin_email = "tyrone@example.org"

    await sign_in("admin")

    response = await client.post(
        f"/api/members/{people['member']}/security",
        json={"action": "suspend", "expected_revision": 1},
    )

    assert response.status_code == 200
    assert response.json()["member"]["is_suspended"] is True
    assert response.json()["member"]["is_demo_account"] is False
