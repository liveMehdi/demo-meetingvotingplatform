from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request

from app.modules.ballots import followup_service, service
from app.modules.ballots.followup_schemas import FollowupCreate, FollowupPreview
from app.modules.ballots.schemas import BallotResponse
from app.modules.meetings.router import Database, Officer

router = APIRouter(prefix="/api/elections", tags=["election follow-ups"])


@router.get("/{source_id}/follow-up", response_model=FollowupPreview)

async def preview(source_id: UUID, officer: Officer, session: Database):
    try:
        return await followup_service.preview(session, officer.id, source_id)
    
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Election not found.") from None


@router.post("/{source_id}/follow-up", status_code=201, response_model=BallotResponse)

async def create(
    source_id: UUID,
    data: FollowupCreate,
    officer: Officer,
    session: Database,
    request: Request,
    key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    
    try:
        result = await followup_service.create(session, officer.id, source_id, data, key)
    except service.BallotNotFound:
        raise HTTPException(status_code=404, detail="Election not found.") from None
    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    
    request.app.state.poll_notifications.changed(result.meeting_id, officers_only=True)
    return result
