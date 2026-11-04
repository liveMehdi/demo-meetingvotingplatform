import asyncio
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app.modules.auth.models import Session
from app.modules.ballots import poll_service
from app.modules.ballots.models import Ballot
from app.modules.ballots.schemas import PollDraftInput
from app.modules.ballots.service import create_draft
from app.modules.realtime import router as realtime
from tests.helpers import call

pytestmark = pytest.mark.integration


@asynccontextmanager
async def websocket(app, path, token, origin="http://testserver"):
    incoming, outgoing = asyncio.Queue(), asyncio.Queue()

    await incoming.put({"type": "websocket.connect"})

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "scheme": "ws",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"origin", origin.encode()), (b"cookie", f"voting_session={token}".encode())],
        "client": ("127.0.0.1", 2468),
        "server": ("testserver", 80),
        "subprotocols": [],
    }

    task = asyncio.create_task(app(scope, incoming.get, outgoing.put))

    try:
        yield outgoing
    finally:
        await incoming.put({"type": "websocket.disconnect", "code": 1000})

        try:
            await asyncio.wait_for(task, 3)
        finally:
            if not task.done():
                task.cancel()

                await asyncio.gather(task, return_exceptions=True)


async def receive(queue):
    return await asyncio.wait_for(queue.get(), 3)


@pytest.mark.parametrize(
    "role,origin", [("member", "http://testserver"), ("officer", "https://untrusted.example")]
)
async def test_websocket_rejects_unauthorised_roles_and_origins(
    app, sign_in, prepared, role, origin
):
    meeting, _ = prepared
    token = await sign_in(role)
    async with websocket(
        app, f"/ws/officer/meetings/{meeting.id}/polls", token, origin
    ) as messages:
        assert await receive(messages) == {"type": "websocket.close", "code": 1008, "reason": ""}


async def test_websocket_disconnects_when_session_expires(app, db, sign_in, prepared, monkeypatch):
    meeting, _ = prepared
    monkeypatch.setattr(realtime, "HEARTBEAT_SECONDS", 0.05)
    token = await sign_in("officer")

    async with websocket(app, f"/ws/officer/meetings/{meeting.id}/polls", token) as messages:
        assert (await receive(messages))["type"] == "websocket.accept"
        assert json.loads((await receive(messages))["text"]) == {"type": "ready"}

        async with db() as session, session.begin():
            await session.execute(
                update(Session).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        while True:
            message = await receive(messages)

            if message["type"] == "websocket.close":
                assert message["code"] == 1008

                break


async def test_poll_notifications_follow_successful_commit_not_rollback(
    app,
    db,
    people,
    sign_in,
    client,
    prepared,
    monkeypatch,
):
    meeting, _ = prepared

    poll = await call(
        db,
        create_draft,
        people["officer"],
        meeting.id,
        PollDraftInput(kind="poll_single", question="Tea?", options=["Yes", "No"]),
    )

    token = await sign_in("officer")

    path = f"/api/meetings/{meeting.id}/polls/{poll.id}/open"

    async with websocket(app, f"/ws/officer/meetings/{meeting.id}/polls", token) as messages:
        assert (await receive(messages))["type"] == "websocket.accept"
        assert json.loads((await receive(messages))["text"])["type"] == "ready"

        async def failed_audit(*args, **kwargs):
            raise RuntimeError("Injected audit failure")

        with monkeypatch.context() as patch:
            patch.setattr(poll_service, "record", failed_audit)

            assert (await client.post(path, json={"expected_revision": 1})).status_code == 500

        async with db() as session:
            assert (await session.get(Ballot, poll.id)).state == "DRAFT"

        with pytest.raises(TimeoutError):
            await asyncio.wait_for(messages.get(), 0.3)
        assert (await client.post(path, json={"expected_revision": 1})).status_code == 200
        assert json.loads((await receive(messages))["text"]) == {"type": "polls.changed"}
        async with db() as session:
            assert (await session.get(Ballot, poll.id)).state == "OPEN"
