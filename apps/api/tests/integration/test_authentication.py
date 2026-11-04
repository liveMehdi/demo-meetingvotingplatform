from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.modules.auth.models import PasswordReset, User
from app.modules.auth.recovery import manage_account
from app.modules.auth.service import password_hasher
from app.modules.members.models import Membership
from app.modules.members.schemas import SecurityUpdate
from tests.helpers import call

pytestmark = pytest.mark.integration
PASSWORD = "orangegreen904"


async def test_registration_login_and_logout(client, db):
    body = {"email": "Kian@example.org", "password": PASSWORD}

    response = await client.post("/api/auth/register", json=body)

    assert response.status_code == 201
    assert response.json()["membership_status"] == "pending"

    async with db() as session:
        user = await session.scalar(select(User).where(User.email == "kian@example.org"))

        assert user.password_hash != PASSWORD
        assert password_hasher.verify(PASSWORD, user.password_hash)
        assert await session.get(Membership, user.id) is not None
        assert not user.is_admin and not user.is_officer

    assert (await client.post("/api/auth/register", json=body)).status_code == 409

    wrong = await client.post("/api/auth/login", json={**body, "password": "purpleblue4112"})
    unknown = await client.post("/api/auth/login", json={**body, "email": "rico@example.org"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    login = await client.post("/api/auth/login", json=body)

    assert login.status_code == 200
    assert "httponly" in login.headers["set-cookie"].lower()

    token = client.cookies.get("voting_session")

    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await client.post("/api/auth/logout")).status_code == 204

    client.cookies.set("voting_session", token)

    assert (await client.get("/api/auth/me")).status_code == 401


async def test_registration_rejects_short_password_and_privilege_fields(client, db):
    for extra in ({"password": "blue"}, {"is_admin": True}, {"is_officer": True}):
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "nico@example.org",
                "password": PASSWORD,
                **extra,
            },
        )
        assert response.status_code == 422
        assert PASSWORD not in response.text

    async with db() as session:
        assert await session.scalar(select(User.id).where(User.email == "nico@example.org")) is None


@pytest.mark.parametrize("expired", [False, True])
async def test_password_reset_is_expiring_single_use_and_revokes_sessions(
    db,
    people,
    client,
    sign_in,
    expired,
):
    reset = await call(
        db,
        manage_account,
        people["admin"],
        people["member"],
        SecurityUpdate(action="issue_reset", expected_revision=1),
    )

    # signing in again after the reset code is issued but before it is used
    token = await sign_in("member")

    if expired:
        async with db() as session, session.begin():
            await session.execute(
                update(PasswordReset).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )

    body = {"code": reset["reset_code"], "password": PASSWORD}
    response = await client.post("/api/auth/reset-password", json=body)
    assert response.status_code == (400 if expired else 204)

    if expired:
        assert (await client.get("/api/auth/me")).status_code == 200

        async with db() as session:
            assert (await session.get(User, people["member"])).password_hash == (
                "unused-in-session-tests"
            )
    else:
        assert (await client.post("/api/auth/reset-password", json=body)).status_code == 400
        client.cookies.set("voting_session", token)

        assert (await client.get("/api/auth/me")).status_code == 401
        assert (
            await client.post(
                "/api/auth/login",
                json={
                    "email": "jonny@example.org",
                    "password": PASSWORD,
                },
            )
        ).status_code == 200
