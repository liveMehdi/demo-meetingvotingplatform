from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.db.creation_requests import CreationKey
from app.modules.ballots import results_service, service
from app.modules.ballots.csv_export import csv_response
from app.modules.ballots.schemas import (
    BallotOpen,
    BallotResponse,
    BallotsPage,
    DraftInput,
    DraftUpdate,
    InvalidateRequest,
    PublishedResults,
)
from app.modules.meetings.router import Database, Officer, permission_error
from app.modules.meetings.service import MeetingNotFound, OfficerRequired

router = APIRouter(prefix="/api/meetings/{meeting_id}/ballots", tags=["ballots"])


@router.post("/{ballot_id}/invalidate", status_code=204)
async def invalidate_ballot(
    meeting_id: UUID,
    ballot_id: UUID,
    data: InvalidateRequest,
    officer: Officer,
    session: Database,
    request: Request,
):
    from app.modules.ballots.invalidation import invalidate

    try:
        await invalidate(session, officer.id, meeting_id, ballot_id, data)

    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    request.app.state.poll_notifications.changed(meeting_id)


@router.get(
    "/{ballot_id}/results.csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def export_results(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):

    try:
        result = await results_service.get_results(
            session, officer.id, ballot_id, meeting_id=meeting_id
        )

    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    
    return csv_response(result)


@router.get("/{ballot_id}/results", response_model=PublishedResults)
async def results(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):
    try:
        return await results_service.get_results(
            session, officer.id, ballot_id, meeting_id=meeting_id
        )
    
    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/{ballot_id}/publish", response_model=BallotResponse)
async def publishing(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):
    try:
        return await service.publish_ballot(session, officer.id, meeting_id, ballot_id)
    
    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/{ballot_id}/close", response_model=BallotResponse)
async def closing(meeting_id: UUID, ballot_id: UUID, officer: Officer, session: Database):
    try:
        return await service.close_ballot(session, officer.id, meeting_id, ballot_id)
    
    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/{ballot_id}/open", response_model=BallotResponse)
async def opening(
    meeting_id: UUID, ballot_id: UUID, data: BallotOpen, officer: Officer, session: Database
):
    try:
        return await service.open_ballot(session, officer.id, meeting_id, ballot_id, data)
    
    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("", status_code=201, response_model=BallotResponse)
async def create(
    meeting_id: UUID, data: DraftInput, officer: Officer, session: Database, key: CreationKey = None
):
    try:
        return await service.create_draft(session, officer.id, meeting_id, data, key)
    
    except OfficerRequired:
        raise permission_error() from None
    
    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


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
            session, officer.id, meeting_id, offset, limit, focus_id=focus_id
        )
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except OfficerRequired:
        raise permission_error() from None
    
    except MeetingNotFound:
        raise HTTPException(status_code=404, detail="Meeting not found.") from None


@router.put("/{ballot_id}", response_model=BallotResponse)
async def update(
    meeting_id: UUID, ballot_id: UUID, data: DraftUpdate, officer: Officer, session: Database
):
    try:
        return await service.update_draft(session, officer.id, meeting_id, ballot_id, data)
    
    except OfficerRequired:
        raise permission_error() from None
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Ballot not found in this meeting.") from None
    
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
