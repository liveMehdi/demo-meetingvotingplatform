from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response

from app.modules.meetings import guest_service
from app.modules.meetings.guest_schemas import (
    GuestJoiningStatus,
    GuestJoiningUpdate,
    GuestJoinRequest,
    GuestMeetingResponse,
)
from app.modules.meetings.router import Database, Officer, permission_error
from app.modules.meetings.service import MeetingNotFound, OfficerRequired

router = APIRouter(prefix="/api/guest", tags=["guests"])
officer_router = APIRouter(prefix="/api/meetings/{meeting_id}/guest-joining", tags=["meetings"])


@officer_router.get("", response_model=GuestJoiningStatus)
async def status(meeting_id: UUID, officer: Officer, session: Database):

    try:
        return await guest_service.get_joining(session, officer.id, meeting_id)

    except OfficerRequired:
        raise permission_error() from None

    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


@officer_router.put("", response_model=GuestJoiningStatus)
async def setting(
    meeting_id: UUID,
    data: GuestJoiningUpdate,
    officer: Officer,
    session: Database,
    request: Request,
):

    try:
        result = await guest_service.set_joining(session, officer.id, meeting_id, data)

    except OfficerRequired:
        raise permission_error() from None
    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None

    except guest_service.JoiningConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None

    # notifying officers after saving, without sending the join code or settings over the socket
    request.app.state.poll_notifications.changed(meeting_id, officers_only=True)

    return result


@router.post("/join", response_model=GuestMeetingResponse)
async def join(data: GuestJoinRequest, request: Request, response: Response, session: Database):
    settings = request.app.state.settings

    try:
        result, token = await guest_service.join_meeting(
            session,
            data.code,
            request.cookies.get(settings.guest_cookie_name),
            settings.guest_session_ttl_seconds,
        )

    except guest_service.GuestJoinUnavailable:
        raise HTTPException(
            status_code=404, detail="Code not available. Check the code or ask the organiser."
        ) from None

    response.set_cookie(
        key=settings.guest_cookie_name,
        value=token,
        max_age=max(0, int((result.session_expires_at - datetime.now(UTC)).total_seconds())),
        expires=result.session_expires_at,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )

    return result


@router.get("/meetings/{meeting_id}", response_model=GuestMeetingResponse)
async def meeting(meeting_id: UUID, request: Request, session: Database):

    try:
        return await guest_service.get_guest_meeting(
            session,
            request.cookies.get(request.app.state.settings.guest_cookie_name),
            meeting_id,
        )

    except guest_service.GuestUnauthenticated:
        raise HTTPException(status_code=401, detail="Join the meeting again to continue.") from None

    except MeetingNotFound:
        raise HTTPException(
            status_code=404, detail="This meeting is not available to you."
        ) from None
