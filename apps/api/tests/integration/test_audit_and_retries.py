from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.db.creation_requests import CreationConflict
from app.db.readiness import schema_is_current
from app.modules.audit.models import AuditAction, AuditEvent
from app.modules.audit.proof import verify
from app.modules.audit.service import export_events
from app.modules.ballots.models import Ballot
from app.modules.ballots.schemas import DraftInput
from app.modules.ballots.service import create_draft
from tests.helpers import call

pytestmark = pytest.mark.integration


async def test_migrations_install_current_schema_and_protected_audit_history(db, people, prepared):
    async with db() as session:
        assert await schema_is_current(session)

    bundle = await call(db, export_events, people["admin"])

    assert [e.action for e in bundle.events] == ["meeting.created", "ballot.created"]
    assert verify(bundle, bundle.checkpoint)["anchored_through"] == 2

    for sql in (
        "UPDATE audit_events SET action = 'meeting.ended'",
        "DELETE FROM audit_events",
        "TRUNCATE audit_events",
    ):
        with pytest.raises(DBAPIError, match="Audit history cannot be changed"):
            async with db() as session, session.begin():
                await session.execute(text(sql))

    after = await call(db, export_events, people["admin"])

    assert after == bundle


async def test_creation_retries_return_original_and_reject_changed_payload(db, people, prepared):
    meeting, _ = prepared

    key = uuid4()

    payload = DraftInput(kind="motion", question="Approve the proposal?")
    first = await call(db, create_draft, people["officer"], meeting.id, payload, key)
    retry = await call(db, create_draft, people["officer"], meeting.id, payload, key)

    assert retry.id == first.id

    with pytest.raises(CreationConflict):
        await call(
            db,
            create_draft,
            people["officer"],
            meeting.id,
            payload.model_copy(update={"question": "Different proposal"}),
            key,
        )

    async with db() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(Ballot).where(Ballot.meeting_id == meeting.id)
            )
            == 2
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(
                    AuditEvent.target_id == first.id,
                    AuditEvent.action == AuditAction.BALLOT_CREATED,
                )
            )
            == 1
        )
