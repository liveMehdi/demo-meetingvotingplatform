import asyncio
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.exc import SQLAlchemyError

from app.modules.realtime.manager import Audience, PollNotifications
from app.modules.realtime.service import AccessDenied, check_access

router = APIRouter(tags=["live polls"])
HEARTBEAT_SECONDS = 15
IO_TIMEOUT_SECONDS = 5
COALESCE_SECONDS = 0.2


async def serve_polls(websocket: WebSocket, meeting_id: UUID, audience: Audience) -> None:
    async def close(code: int):
        try:
            async with asyncio.timeout(IO_TIMEOUT_SECONDS):
                await websocket.close(code=code)

        except (WebSocketDisconnect, OSError, RuntimeError, TimeoutError):
            # ignoring close errors if the connection is already gone or too slow
            pass

    settings = websocket.app.state.settings

    if (
        websocket.headers.get("origin") not in settings.allowed_origins
        or websocket.headers.get("sec-fetch-site") == "cross-site"
        or websocket.scope.get("query_string")
    ):
        await close(1008)
        return

    factory = websocket.app.state.session_factory

    if factory is None:
        await close(1013)
        return

    cookie = settings.guest_cookie_name if audience == "guest" else settings.session_cookie_name
    token = websocket.cookies.get(cookie)
    manager: PollNotifications = websocket.app.state.poll_notifications

    async def authorised():
        async with asyncio.timeout(IO_TIMEOUT_SECONDS):
            return await check_access(factory, audience, token, meeting_id)

    async def send(type: str):
        async with asyncio.timeout(IO_TIMEOUT_SECONDS):
            await websocket.send_json({"type": type})

    event = None
    tasks = []

    try:
        expires_at = await authorised()
        await websocket.accept()
        event = manager.subscribe(meeting_id, audience)

        # sending ready after subscribing so the client reloads data, including on reconnect
        await send("ready")

        async def publish():
            nonlocal expires_at

            while not manager.stopping:
                remaining = (expires_at - datetime.now(UTC)).total_seconds()

                if remaining <= 0:
                    raise AccessDenied

                try:
                    async with asyncio.timeout(min(HEARTBEAT_SECONDS, remaining)):
                        await event.wait()
                    # grouping quick changes into one refresh
                    await asyncio.sleep(COALESCE_SECONDS)
                    event.clear()
                    changed = True

                except TimeoutError:
                    changed = False

                if manager.stopping:
                    return

                expires_at = await authorised()
                await send("polls.changed" if changed else "heartbeat")

        async def receive():
            message = await websocket.receive()

            if message["type"] != "websocket.disconnect":
                raise AccessDenied

        tasks = [asyncio.create_task(publish()), asyncio.create_task(receive())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

        for task in done:
            task.result()

        if manager.stopping:
            await close(1001)

    except AccessDenied:
        await close(1008)

    except (SQLAlchemyError, TimeoutError):
        # closing without logging tokens or affecting changes already saved
        await close(1013)

    except (WebSocketDisconnect, OSError):
        pass
    finally:
        for task in tasks:
            task.cancel()

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if event is not None:
            manager.unsubscribe(meeting_id, audience, event)


@router.websocket("/ws/guest/meetings/{meeting_id}/polls")
async def guest_polls(websocket: WebSocket, meeting_id: UUID):
    await serve_polls(websocket, meeting_id, "guest")


@router.websocket("/ws/officer/meetings/{meeting_id}/polls")
async def officer_polls(websocket: WebSocket, meeting_id: UUID):
    await serve_polls(websocket, meeting_id, "officer")
