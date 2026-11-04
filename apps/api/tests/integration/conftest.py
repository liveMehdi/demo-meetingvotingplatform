from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.modules.auth.models import Session, User
from app.modules.auth.service import session_digest
from app.modules.members.models import Membership, MembershipStatus
from tests.database import isolated_database
from tests.helpers import open_prepared, prepare_ballot


@pytest.fixture
async def db():
    async with isolated_database() as factory:
        yield factory


@pytest.fixture
async def people(db):
    people = {}

    async with db() as session, session.begin():
        for role, name in (
            ("admin", "tyrone"),
            ("officer", "shan"),
            ("member", "jonny"),
            ("absent", "nico"),
            ("pending", "rico"),
        ):
            user = User(
                email=f"{name}@example.org",
                password_hash="unused-in-session-tests",
                is_admin=role == "admin",
                is_officer=role == "officer",
            )
            session.add(user)

            await session.flush()

            # admins and officers still need membership approval
            status = (
                MembershipStatus.APPROVED
                if role in {"member", "absent"}
                else MembershipStatus.PENDING
            )

            session.add(Membership(user_id=user.id, status=status))

            people[role] = user.id

    return people


@pytest.fixture
async def prepared(db, people):
    return await prepare_ballot(db, people["officer"])


@pytest.fixture
async def opened(db, people, prepared):
    meeting, ballot = prepared

    return meeting, await open_prepared(db, people["officer"], meeting, ballot)


@pytest.fixture
async def app(db):
    from app.main import create_app

    settings = Settings(
        _env_file=None,
        database_url=None,
        app_env="development",
        web_dist_dir=None,
        allowed_origins=["http://testserver"],
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        app.state.session_factory = db

        yield app


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": "http://testserver", "X-CSRF-Protection": "1"},
    ) as http:
        yield http


@pytest.fixture
def sign_in(db, client, people):
    async def sign_in(role, *, expired=False):
        import secrets

        token = secrets.token_urlsafe(32)

        now = datetime.now(UTC)

        async with db() as session, session.begin():
            session.add(
                Session(
                    token_hash=session_digest(token),
                    user_id=people[role],
                    created_at=now - timedelta(hours=2),
                    expires_at=now + timedelta(hours=-1 if expired else 1),
                )
            )
        client.cookies.clear()
        client.cookies.set("voting_session", token)

        return token

    return sign_in
