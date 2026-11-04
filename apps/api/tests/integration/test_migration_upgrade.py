from uuid import uuid4

import pytest
from sqlalchemy import text

from app.db.readiness import schema_is_current
from app.modules.audit.proof import verify
from app.modules.audit.service import build_export
from tests.database import isolated_database, migrate

pytestmark = pytest.mark.integration


async def test_upgrade_retains_existing_accounts_attendance_votes_and_audit():
    # starting with the older database before these updates were added
    async with isolated_database("0013_ranked_elections") as factory:
        user, meeting, ballot, option, vote, audit = [uuid4() for _ in range(6)]

        async with factory() as session, session.begin():
            for sql, params in [
                (
                    "INSERT INTO users (id,email,password_hash) "
                    "VALUES (:u,'kian@example.org','hash')",
                    {"u": user},
                ),
                ("INSERT INTO memberships (user_id,status) VALUES (:u,'approved')", {"u": user}),
                (
                    "INSERT INTO meetings (id,title,scheduled_at,created_by) "
                    "VALUES (:m,'Existing meeting',now(),:u)",
                    {"m": meeting, "u": user},
                ),
                (
                    "INSERT INTO attendance (meeting_id,user_id,present,recorded_by) "
                    "VALUES (:m,:u,true,:u)",
                    {"m": meeting, "u": user},
                ),
                (
                    "INSERT INTO ballots (id,meeting_id,kind,question,created_by,state,opened_at,"
                    "opened_by,eligibility_policy,eligible_count,eligible_attendance_count) "
                    "VALUES (:b,:m,'election','Old election',:u,'OPEN',"
                    "now(),:u,'all_approved',1,1)",
                    {"b": ballot, "m": meeting, "u": user},
                ),
                (
                    "INSERT INTO options (id,ballot_id,label,position) VALUES (:o,:b,'Tyrone',0)",
                    {"o": option, "b": ballot},
                ),
                ("INSERT INTO ballot_eligibility VALUES (:b,:u,true)", {"b": ballot, "u": user}),
                ("INSERT INTO participation_receipts VALUES (:b,:u)", {"b": ballot, "u": user}),
                ("INSERT INTO votes (id,ballot_id) VALUES (:v,:b)", {"v": vote, "b": ballot}),
                (
                    "INSERT INTO vote_choices (vote_id,option_id,ballot_id) VALUES (:v,:o,:b)",
                    {"v": vote, "o": option, "b": ballot},
                ),
                (
                    "INSERT INTO audit_events (id,action,actor_id,target_id,meeting_id) "
                    "VALUES (:a,'ballot.opened',:u,:b,:m)",
                    {"a": audit, "u": user, "b": ballot, "m": meeting},
                ),
            ]:
                await session.execute(text(sql), params)

        engine = factory.kw["bind"]

        async with engine.begin() as connection:
            await connection.run_sync(migrate)

        async with factory() as session, session.begin():
            assert await schema_is_current(session)
            assert await session.scalar(
                text("SELECT email FROM users WHERE id=:u"), {"u": user}
            ) == ("kian@example.org")
            assert await session.scalar(text("SELECT count(*) FROM attendance_changes")) == 1
            assert await session.scalar(text("SELECT option_id FROM vote_choices")) == option
            
            assert await session.scalar(text("SELECT user_id FROM participation_receipts")) == user
            assert await session.scalar(text("SELECT needs_status_review FROM meetings")) is True

            from app.modules.audit.models import AuditChain

            bundle = await build_export(session, await session.get(AuditChain, 1))

            assert bundle.events[0].id == audit
            assert verify(bundle, bundle.checkpoint)["legacy_events"] == 1
