import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import uuid4

from asyncpg import PostgresError
from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.csrf import require_csrf
from app.core.rate_limit import RequestLimiter
from app.core.web import FrontendFiles
from app.db.creation_requests import CreationConflict
from app.db.readiness import schema_is_current
from app.db.session import build_engine, get_session
from app.modules.audit.router import router as audit_router
from app.modules.auth.demo import DemoAccountProtected
from app.modules.auth.router import router as auth_router
from app.modules.ballots.followup_router import router as followup_router
from app.modules.ballots.member_router import router as member_ballots_router
from app.modules.ballots.poll_router import guest_router as guest_polls_router
from app.modules.ballots.poll_router import router as polls_router
from app.modules.ballots.router import router as ballots_router
from app.modules.meetings.guest_router import officer_router as guest_officer_router
from app.modules.meetings.guest_router import router as guest_router
from app.modules.meetings.router import router as meetings_router
from app.modules.meetings.service import MeetingConflict, MeetingNotFound, OfficerRequired
from app.modules.members.router import router as members_router
from app.modules.nominations.router import router as nominations_router
from app.modules.realtime.manager import PollNotifications
from app.modules.realtime.router import router as realtime_router


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["voting-api"]


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.poll_notifications = PollNotifications()
        engine = build_engine(config.require_database_url()) if config.database_url else None
        app.state.session_factory = (
            async_sessionmaker(engine, expire_on_commit=False) if engine else None
        )

        try:
            yield
        finally:
            app.state.poll_notifications.shutdown()

            if engine is not None:
                await engine.dispose()

    app = FastAPI(
        title="Voting Platform API",
        version="0.1.0",
        lifespan=lifespan,
        dependencies=[Depends(require_csrf)],
    )
    app.state.settings = config
    app.state.session_factory = None

    app.state.poll_notifications = PollNotifications()
    app.state.request_limiter = RequestLimiter()

    @app.exception_handler(DemoAccountProtected)
    async def demo_account_protected(_request, exc):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    @app.middleware("http")
    async def prevent_private_caching(request, call_next):
        retry_after = (
            app.state.request_limiter.retry_after(
                request.url.path, request.client.host if request.client else "unknown"
            )
            if request.method == "POST"
            else 0
        )

        if retry_after:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many attempts. Wait before trying again."},
                headers={"Retry-After": str(retry_after), "Cache-Control": "no-store"},
            )

        try:
            response = await call_next(request)

        except Exception as exc:
            reference = uuid4().hex
            # logging only the reference, route pattern and error type to keep private data out
            route = getattr(request.scope.get("route"), "path", "unmatched")

            logging.getLogger("voting.errors").error(
                "request_failed reference=%s route=%s error_type=%s",
                reference,
                route,
                type(exc).__name__,
            )

            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "The request failed. Contact an administrator with this reference.",
                    "reference": reference,
                },
                headers={"Cache-Control": "no-store"},
            )

        if request.url.path.startswith(
            (
                "/api/auth/",
                "/api/ready",
                "/api/members",
                "/api/meetings",
                "/api/ballots",
                "/api/elections",
                "/api/audit",
                "/api/guest",
                "/api/nominations",
            )
        ):
            response.headers["Cache-Control"] = "no-store"

        return response

    @app.exception_handler(CreationConflict)
    async def creation_conflict(_request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request, exc: RequestValidationError):
        # returning field errors without extra details
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()
                ]
            },
        )

    @app.exception_handler(MeetingConflict)
    async def meeting_conflict(_request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(MeetingNotFound)
    async def meeting_missing(_request, _exc):
        return JSONResponse(status_code=404, content={"detail": "Meeting not found."})

    @app.exception_handler(OfficerRequired)
    async def officer_required(_request, _exc):
        return JSONResponse(status_code=403, content={"detail": "Officer access is required."})

    app.include_router(auth_router)
    app.include_router(audit_router)
    app.include_router(members_router)
    app.include_router(meetings_router)
    app.include_router(guest_router)
    app.include_router(guest_officer_router)
    app.include_router(ballots_router)
    app.include_router(followup_router)
    app.include_router(polls_router)
    app.include_router(guest_polls_router)
    app.include_router(member_ballots_router)
    app.include_router(nominations_router)
    app.include_router(realtime_router)

    @app.get("/api/health", response_model=HealthResponse, tags=["health"])
    async def health() -> HealthResponse:
        """checking the API is running, with the database checked separately"""

        return HealthResponse(status="ok", service="voting-api")

    @app.get("/api/ready", tags=["health"])
    async def ready(session: Annotated[AsyncSession, Depends(get_session)]):
        try:
            async with asyncio.timeout(5):
                current = await schema_is_current(session)

        except (SQLAlchemyError, PostgresError, OSError, TimeoutError):
            current = False

        return JSONResponse(
            status_code=200 if current else 503,
            content={"status": "ready" if current else "unavailable"},
            headers={"Cache-Control": "no-store"},
        )

    # serving the frontend last so api and websocket routes are matched first
    if config.web_dist_dir is not None:
        app.mount("/", FrontendFiles(config.web_dist_dir), name="frontend")

    return app


app = create_app()
