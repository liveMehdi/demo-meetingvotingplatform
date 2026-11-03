from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.modules.auth.router import require_current_user
from app.modules.auth.schemas import CurrentUserResponse
from app.modules.ballots import results_service, service, voting_service
from app.modules.ballots.csv_export import csv_response
from app.modules.ballots.schemas import (
    MemberBallot,
    MemberBallotsPage,
    PublishedResults,
    SubmissionReceipt,
    VoteSubmission,
)

router = APIRouter(prefix="/api/ballots", tags=["member ballots"])

SignedIn = Annotated[CurrentUserResponse, Depends(require_current_user)]
Database = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/{ballot_id}/results.csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def export_results(ballot_id: UUID, user: SignedIn, session: Database):
    try:
        result = await results_service.get_results(session, user.id, ballot_id)

    except service.BallotNotFound:
        raise HTTPException(
            status_code=404, detail="Ballot not available to this account."
        ) from None

    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None

    return csv_response(result)


@router.get("/{ballot_id}/results", response_model=PublishedResults)
async def results(ballot_id: UUID, user: SignedIn, session: Database):
    try:
        return await results_service.get_results(session, user.id, ballot_id)

    except service.BallotNotFound:
        raise HTTPException(
            status_code=404, detail="Ballot not available to this account."
        ) from None

    except service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.get("", response_model=MemberBallotsPage)
async def listing(
    user: SignedIn,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    view: Literal["all", "ready", "submitted", "results"] = "all",
):
    return await voting_service.list_member_ballots(session, user.id, offset, limit, view=view)


@router.get("/{ballot_id}", response_model=MemberBallot)
async def detail(ballot_id: UUID, user: SignedIn, session: Database):
    try:
        return await voting_service.get_member_ballot(session, user.id, ballot_id)

    except voting_service.BallotUnavailable:
        raise HTTPException(
            status_code=404, detail="Ballot not available to this account."
        ) from None


@router.post("/{ballot_id}/votes", response_model=SubmissionReceipt)
async def vote(ballot_id: UUID, data: VoteSubmission, user: SignedIn, session: Database):
    try:
        return await voting_service.cast_vote(session, user.id, ballot_id, data)

    except voting_service.BallotUnavailable:
        raise HTTPException(
            status_code=404, detail="Ballot not available to this account."
        ) from None

    except voting_service.VotingClosed:
        raise HTTPException(status_code=409, detail="Voting is closed.") from None

    except voting_service.InvalidChoices:
        raise HTTPException(
            status_code=422, detail="Choose exactly one of this ballot's options."
        ) from None
