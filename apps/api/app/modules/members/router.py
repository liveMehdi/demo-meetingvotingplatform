from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.modules.auth.router import require_current_user
from app.modules.auth.schemas import CurrentUserResponse
from app.modules.members import service
from app.modules.members.schemas import (
    MemberResponse,
    MembershipUpdate,
    MembersPage,
    OfficerUpdate,
    SecurityUpdate,
)

router = APIRouter(prefix="/api/members", tags=["members"])


async def require_admin(
    user: Annotated[CurrentUserResponse, Depends(require_current_user)],
) -> CurrentUserResponse:
    
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    
    return user


Admin = Annotated[CurrentUserResponse, Depends(require_admin)]
Database = Annotated[AsyncSession, Depends(get_session)]


def permission_error() -> HTTPException:
    return HTTPException(status_code=403, detail="Administrator access is required.")


@router.post("/{user_id}/security")
async def account_security(user_id: UUID, data: SecurityUpdate, admin: Admin, session: Database):
    from app.modules.auth.recovery import SecurityConflict, manage_account

    try:
        return await manage_account(session, admin.id, user_id, data)
    except service.AdminRequired:
        raise permission_error() from None
    
    except service.MemberNotFound:
        raise HTTPException(status_code=404, detail="Account not found.") from None
    
    except SecurityConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.get("", response_model=MembersPage)
async def members(
    admin: Admin,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    view: Literal["all", "pending", "approved", "officers"] = "all",
    q: Annotated[str, Query(max_length=200)] = "",
) -> MembersPage:
    
    try:
        return await service.list_members(session, admin.id, offset, limit, view=view, q=q)
    except service.AdminRequired:
        raise permission_error() from None


@router.patch("/{user_id}/membership", response_model=MemberResponse)
async def membership(
    user_id: UUID, change: MembershipUpdate, admin: Admin, session: Database
) -> MemberResponse:
    try:
        return await service.update_membership(session, admin.id, user_id, change)
    except service.AdminRequired:
        raise permission_error() from None
    
    except service.MemberNotFound:
        raise HTTPException(status_code=404, detail="Membership not found.") from None


@router.patch("/{user_id}/officer", response_model=MemberResponse)
async def officer(
    user_id: UUID, change: OfficerUpdate, admin: Admin, session: Database
) -> MemberResponse:
    try:
        return await service.update_officer(session, admin.id, user_id, change)
    
    except service.AdminRequired:
        raise permission_error() from None
    except service.MemberNotFound:
        raise HTTPException(status_code=404, detail="Account not found.") from None
