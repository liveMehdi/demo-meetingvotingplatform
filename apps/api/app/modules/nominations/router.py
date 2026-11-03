from contextlib import contextmanager
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth.router import require_current_user
from app.modules.auth.schemas import CurrentUserResponse
from app.modules.meetings.router import Database
from app.modules.nominations import service
from app.modules.nominations.schemas import (
    ContestsPage,
    NominationCreate,
    NominationResponse,
    NominationsPage,
    NomineeDecision,
    OfficerDecision,
    WindowUpdate,
)

router = APIRouter(prefix="/api/nominations", tags=["nominations"])
Account = Annotated[CurrentUserResponse, Depends(require_current_user)]
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=100)]


@contextmanager
def nomination_errors():
    try:
        yield

    except service.NominationDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    
    except service.NominationMissing:
        raise HTTPException(status_code=404, detail="Nomination or contest not found.") from None
    except service.NominationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.get("/contests", response_model=ContestsPage)
async def contests(
    user: Account,
    session: Database,
    offset: Offset = 0,

    limit: Limit = 20,
    view: Literal["all", "consent", "mine", "open", "withdraw"] = "all",
):
    with nomination_errors():
        return await service.list_contests(session, user.id, offset, limit, view=view)


@router.get("/{ballot_id}", response_model=NominationsPage)

async def mine(
    ballot_id: UUID, user: Account, session: Database, offset: Offset = 0, limit: Limit = 20
):
    with nomination_errors():
        return await service.list_nominations(session, user.id, ballot_id, offset, limit)


@router.get("/{ballot_id}/officer", response_model=NominationsPage)

async def review_list(
    ballot_id: UUID, user: Account, session: Database, offset: Offset = 0, limit: Limit = 20
):
    with nomination_errors():
        return await service.list_nominations(

            session, user.id, ballot_id, offset, limit, officer=True
        )


@router.put("/{ballot_id}/window")
async def window(ballot_id: UUID, data: WindowUpdate, user: Account, session: Database):
    
    with nomination_errors():
        return await service.set_window(session, user.id, ballot_id, data)


@router.post("/{ballot_id}", response_model=NominationResponse, status_code=201)
async def nominate(ballot_id: UUID, data: NominationCreate, user: Account, session: Database):

    with nomination_errors():
        return await service.create(session, user.id, ballot_id, data)


@router.put("/{ballot_id}/{nomination_id}/consent", response_model=NominationResponse)

async def consent(
    ballot_id: UUID, nomination_id: UUID, data: NomineeDecision, user: Account, session: Database
):
    
    with nomination_errors():
        return await service.decide(session, user.id, ballot_id, nomination_id, data)


@router.put("/{ballot_id}/{nomination_id}/review", response_model=NominationResponse)
async def review(
    ballot_id: UUID, nomination_id: UUID, data: OfficerDecision, user: Account, session: Database
):
    
    with nomination_errors():
        return await service.decide(session, user.id, ballot_id, nomination_id, data)
