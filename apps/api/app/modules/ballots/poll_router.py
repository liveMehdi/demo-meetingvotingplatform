from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from app.db.creation_requests import CreationKey
from app.modules.ballots import poll_service, service
from app.modules.ballots.schemas import (
    BallotResponse,
    BallotsPage,
    GuestPollsPage,
    PollDraftInput,
    PollDraftUpdate,
    PollOpen,
    PollPresentation,
    PollResults,
    SubmissionReceipt,
    VoteSubmission,
)
from app.modules.ballots.voting_service import InvalidChoices, VotingClosed
from app.modules.meetings.guest_service import GuestUnauthenticated
from app.modules.meetings.router import Database, Officer, permission_error
from app.modules.meetings.service import MeetingNotFound, OfficerRequired

router = APIRouter(prefix="/api/meetings/{meeting_id}/polls", tags=["polls"])
guest_router = APIRouter(prefix="/api/guest/meetings/{meeting_id}/polls", tags=["guest polls"])


@contextmanager
def poll_errors():
    try:
        yield

    except OfficerRequired:
        raise permission_error() from None

    except GuestUnauthenticated:
        raise HTTPException(status_code=401, detail="Join the meeting again to continue.") from None

    except (MeetingNotFound, service.BallotNotFound):
        raise HTTPException(status_code=404, detail="Poll or meeting not available.") from None

    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None

    except VotingClosed:
        raise HTTPException(status_code=409, detail="This poll is closed.") from None

    except InvalidChoices:
        raise HTTPException(
            status_code=422, detail="Choose different options within the allowed number of choices."
        ) from None


@router.post("/{ballot_id}/open", response_model=BallotResponse)
async def opening(
    meeting_id: UUID,
    ballot_id: UUID,
    data: PollOpen,
    officer: Officer,
    session: Database,
    request: Request,
):
    with poll_errors():
        result = await poll_service.open_poll(session, officer.id, meeting_id, ballot_id, data)

    request.app.state.poll_notifications.changed(meeting_id)

    return result


@router.post("/{ballot_id}/close", response_model=BallotResponse)
async def closing(
    meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database, request: Request
):
    with poll_errors():
        result = await poll_service.close_poll(session, officer.id, meeting_id, ballot_id)
    request.app.state.poll_notifications.changed(meeting_id)
    return result


@router.get("/{ballot_id}/results", response_model=PollResults)
async def results(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):
    with poll_errors():
        return await poll_service.officer_results(session, officer.id, meeting_id, ballot_id)


@router.get("/{ballot_id}/presentation", response_model=PollPresentation)
async def presentation(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):
    with poll_errors():
        return await poll_service.presentation(session, officer.id, meeting_id, ballot_id)


@guest_router.get("", response_model=GuestPollsPage)
async def guest_polls(
    meeting_id: UUID,
    request: Request,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    with poll_errors():
        return await poll_service.list_guest_polls(
            session,
            request.cookies.get(request.app.state.settings.guest_cookie_name),
            meeting_id,
            offset,
            limit,
        )


@guest_router.post("/{ballot_id}/responses", response_model=SubmissionReceipt)
async def submit(
    meeting_id: UUID,
    ballot_id: UUID,
    data: VoteSubmission,
    request: Request,
    session: Database,
):
    with poll_errors():
        result = await poll_service.submit_response(
            session,
            request.cookies.get(request.app.state.settings.guest_cookie_name),
            meeting_id,
            ballot_id,
            data,
        )

    if not result.already_submitted:
        request.app.state.poll_notifications.changed(meeting_id)

    return result


@router.post("", status_code=201, response_model=BallotResponse)
async def create(
    meeting_id: UUID,
    data: PollDraftInput,
    officer: Officer,
    session: Database,
    request: Request,
    key: CreationKey = None,
):
    
    try:
        result = await service.create_draft(session, officer.id, meeting_id, data, key)

    except OfficerRequired:
        raise permission_error() from None

    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None
    request.app.state.poll_notifications.changed(meeting_id, officers_only=True)

    return result


@router.get("", response_model=BallotsPage)
async def listing(
    meeting_id: UUID,
    officer: Officer,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    focus_id: UUID | None = None,
):
    try:
        return await service.list_ballots(
            session, officer.id, meeting_id, offset, limit, polls=True, focus_id=focus_id
        )

    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Poll not found in this meeting.") from None

    except OfficerRequired:
        raise permission_error() from None

    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


@router.put("/{ballot_id}", response_model=BallotResponse)
async def update(
    meeting_id: UUID,
    ballot_id: UUID,
    data: PollDraftUpdate,
    officer: Officer,
    session: Database,
    request: Request,
):
    try:
        result = await service.update_draft(session, officer.id, meeting_id, ballot_id, data)

    except OfficerRequired:
        raise permission_error() from None

    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Poll not found in this meeting.") from None

    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    request.app.state.poll_notifications.changed(meeting_id, officers_only=True)

    return result
