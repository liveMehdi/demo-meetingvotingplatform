from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.creation_requests import CreationKey
from app.db.session import get_session
from app.modules.auth.router import require_current_user
from app.modules.auth.schemas import CurrentUserResponse
from app.modules.meetings import attendance_service, lifecycle_service, service
from app.modules.meetings.schemas import (
    AttendanceHistory,
    AttendanceMember,
    AttendancePage,
    AttendanceUpdate,
    CompletionSummary,
    DraftWithdrawal,
    EligibilitySettingUpdate,
    MeetingCreate,
    MeetingHistory,
    MeetingResponse,
    MeetingsPage,
    MeetingTransition,
    MeetingUpdate,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def permission_error() -> HTTPException:
    return HTTPException(status_code=403, detail="Officer access is required.")


async def require_officer(
    user: Annotated[CurrentUserResponse, Depends(require_current_user)],
) -> CurrentUserResponse:
    if not user.is_officer:
        raise permission_error()

    return user


Officer = Annotated[CurrentUserResponse, Depends(require_officer)]
Database = Annotated[AsyncSession, Depends(get_session)]


@router.put("/{meeting_id}", response_model=MeetingResponse)
async def update_details(
    meeting_id: UUID, data: MeetingUpdate, officer: Officer, session: Database, request: Request
):
    result = await lifecycle_service.update_details(session, officer.id, meeting_id, data)
    request.app.state.poll_notifications.changed(meeting_id)

    return result


@router.get("/{meeting_id}/history", response_model=MeetingHistory)
async def history(
    meeting_id: UUID,
    officer: Officer,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return await lifecycle_service.history(session, officer.id, meeting_id, offset, limit)


@router.get("/{meeting_id}/completion", response_model=CompletionSummary)
async def completion(meeting_id: UUID, officer: Officer, session: Database):
    return await lifecycle_service.completion(session, officer.id, meeting_id)


@router.post("/{meeting_id}/transition", response_model=MeetingResponse)
async def transition(
    meeting_id: UUID, data: MeetingTransition, officer: Officer, session: Database, request: Request
):
    result = await lifecycle_service.transition(session, officer.id, meeting_id, data)
    request.app.state.poll_notifications.changed(meeting_id)

    return result


@router.post("/{meeting_id}/drafts/{ballot_id}/withdraw", status_code=204)
async def withdraw_draft(
    meeting_id: UUID,
    ballot_id: UUID,
    data: DraftWithdrawal,
    officer: Officer,
    session: Database,
    request: Request,
):
    await lifecycle_service.withdraw_draft(
        session, officer.id, meeting_id, ballot_id, data.expected_revision
    )
    request.app.state.poll_notifications.changed(meeting_id, officers_only=True)


@router.put("/{meeting_id}/eligibility", response_model=MeetingResponse)
async def eligibility_setting(
    meeting_id: UUID, data: EligibilitySettingUpdate, officer: Officer, session: Database
):
    try:
        return await service.update_eligibility_setting(session, officer.id, meeting_id, data)

    except service.OfficerRequired:
        raise permission_error() from None
    except service.MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None
    except service.EligibilitySettingConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("", status_code=201, response_model=MeetingResponse)
async def create(
    data: MeetingCreate, officer: Officer, session: Database, key: CreationKey = None
) -> MeetingResponse:
    try:
        return await service.create_meeting(session, officer.id, data, key)

    except service.OfficerRequired:
        raise permission_error() from None


@router.get("", response_model=MeetingsPage)
async def meetings(
    officer: Officer,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    view: Literal["all", "upcoming", "past", "planned", "live", "ended", "cancelled"] = "all",
    q: Annotated[str, Query(max_length=200)] = "",
) -> MeetingsPage:
    try:
        return await service.list_meetings(session, officer.id, offset, limit, view=view, q=q)
    except service.OfficerRequired:
        raise permission_error() from None


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def detail(meeting_id: UUID, officer: Officer, session: Database) -> MeetingResponse:
    try:
        return await service.get_meeting(session, officer.id, meeting_id)

    except service.OfficerRequired:
        raise permission_error() from None

    except service.MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


@router.get("/{meeting_id}/attendance", response_model=AttendancePage)
async def attendance(
    meeting_id: UUID,
    officer: Officer,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AttendancePage:
    try:
        return await attendance_service.list_attendance(
            session, officer.id, meeting_id, offset, limit
        )

    except service.OfficerRequired:
        raise permission_error() from None

    except service.MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


@router.put("/{meeting_id}/attendance/{user_id}", response_model=AttendanceMember)
async def record_attendance(
    meeting_id: UUID, user_id: UUID, change: AttendanceUpdate, officer: Officer, session: Database
) -> AttendanceMember:
    try:
        return await attendance_service.set_attendance(
            session, officer.id, meeting_id, user_id, change
        )
    except service.OfficerRequired:
        raise permission_error() from None
    except service.MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None

    except attendance_service.MemberNotFound:
        raise HTTPException(status_code=404, detail="Member not found.") from None

    except attendance_service.ApprovalRequired:
        raise HTTPException(
            status_code=409,
            detail=(
                "Approved membership is required to record attendance. "
                "Existing records can be marked absent."
            ),
        ) from None


@router.get("/{meeting_id}/attendance-history", response_model=AttendanceHistory)
async def attendance_changes(
    meeting_id: UUID,
    officer: Officer,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return await attendance_service.attendance_history(
        session, officer.id, meeting_id, offset, limit
    )
