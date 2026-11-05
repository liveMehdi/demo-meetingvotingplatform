from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.modules.auth import service
from app.modules.auth.schemas import (
    CurrentUserResponse,
    LoginRequest,
    RegistrationRequest,
    RegistrationResponse,
    ResetPasswordRequest,
)
from app.modules.auth.service import EmailAlreadyRegistered, register_account

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/demo")
async def demo_account(request: Request):
    settings = request.app.state.settings
    if settings.demo_admin_email is None or settings.demo_admin_password is None:
        return None

    # sharing only the dedicated demo login when it has been enabled
    return {
        "email": settings.demo_admin_email,
        "password": settings.demo_admin_password.get_secret_value(),
    }


@router.post("/reset-password", status_code=204, response_class=Response)
async def reset_password(
    data: ResetPasswordRequest, session: Annotated[AsyncSession, Depends(get_session)]
):
    from app.modules.auth import recovery

    try:
        await recovery.reset_password(
            session, data.code.get_secret_value(), data.password.get_secret_value()
        )

    except recovery.SecurityConflict as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    
    return Response(status_code=204)


async def require_current_user(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> CurrentUserResponse:
    
    token = request.cookies.get(request.app.state.settings.session_cookie_name)
    try:
        return await service.current_user(session, token)
    
    except service.Unauthenticated:
        raise HTTPException(status_code=401, detail="Sign in to continue.") from None


@router.get("/me", response_model=CurrentUserResponse)

async def me(user: Annotated[CurrentUserResponse, Depends(require_current_user)]):
    return user


@router.post("/login", response_model=CurrentUserResponse)
async def login(
    credentials: LoginRequest,
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrentUserResponse:
    
    settings = request.app.state.settings
    try:
        user, token, expires_at = await service.login(
            session,
            credentials,
            request.cookies.get(settings.session_cookie_name),
            settings.session_ttl_seconds,
        )

    except service.InvalidCredentials:
        raise HTTPException(status_code=401, detail="Invalid email or password.") from None
    
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        expires=expires_at,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return user


@router.post("/logout", status_code=204, response_class=Response)
async def logout(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> Response:
    
    settings = request.app.state.settings

    await service.logout(session, request.cookies.get(settings.session_cookie_name))
    response = Response(status_code=204)

    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )

    return response


@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_201_CREATED)
async def register(
    registration: RegistrationRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RegistrationResponse:
    
    try:
        return await register_account(session, registration)
    
    except EmailAlreadyRegistered:
        
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from None
