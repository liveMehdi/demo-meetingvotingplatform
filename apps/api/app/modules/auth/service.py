import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.modules.auth.models import Session, User
from app.modules.auth.schemas import (
    CurrentUserResponse,
    LoginRequest,
    RegistrationRequest,
    RegistrationResponse,
)
from app.modules.members.models import Membership

password_hasher = PasswordHash.recommended()
_dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))


class InvalidCredentials(Exception):
    """Same error for an unknown email or wrong password."""


class Unauthenticated(Exception):
    """No valid sign-in session for this cookie."""


def session_digest(token: str | None) -> str | None:

    if token is None or re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
        return None
    
    return hashlib.sha256(token.encode("ascii")).hexdigest()


async def login(
    session: AsyncSession, credentials: LoginRequest, previous_token: str | None, ttl_seconds: int
) -> tuple[CurrentUserResponse, str, datetime]:
    
    # Finishing the db lookup before checking the password.

    async with session.begin():
        account = (
            await session.execute(
                select(User.id, User.password_hash).where(User.email == str(credentials.email))
            )
        ).first()

    stored_hash = account.password_hash if account else _dummy_password_hash

    try:
        valid, updated_hash = await run_in_threadpool(
            password_hasher.verify_and_update, credentials.password.get_secret_value(), stored_hash
        )

    except UnknownHashError:
        # Rejecting unreadable hashes.
        raise InvalidCredentials from None
    
    if not valid or account is None:
        raise InvalidCredentials

    token = secrets.token_urlsafe(32)
    created_at = datetime.now(UTC)
    expires_at = created_at + timedelta(seconds=ttl_seconds)

    async with session.begin():
    
        user = await session.scalar(select(User).where(User.id == account.id).with_for_update())

        if user is None or user.is_suspended or user.password_hash != stored_hash:
            raise InvalidCredentials
        
        if updated_hash is not None:
            user.password_hash = updated_hash

        old_digest = session_digest(previous_token)

        if old_digest is not None:
            await session.execute(delete(Session).where(Session.token_hash == old_digest))

        session.add(
            Session(
                token_hash=session_digest(token),
                user_id=user.id,
                created_at=created_at,
                expires_at=expires_at,
            )
        )


        membership_status = await session.scalar(
            select(Membership.status).where(Membership.user_id == user.id)
        )

        result = CurrentUserResponse(
            id=user.id,
            email=user.email,
            is_admin=user.is_admin,
            is_officer=user.is_officer,
            membership_status=membership_status,
        )

    return result, token, expires_at


async def current_user(session: AsyncSession, token: str | None) -> CurrentUserResponse:

    digest = session_digest(token)

    if digest is None:
        raise Unauthenticated
    
    async with session.begin():

        row = (
            await session.execute(
                select(User, Membership.status)
                .join(Session, Session.user_id == User.id)
                .outerjoin(Membership, Membership.user_id == User.id)
                .where(
                    Session.token_hash == digest,
                    Session.expires_at > func.now(),
                    User.is_suspended.is_(False),
                )
            )
        ).first()

        if row is None:
            raise Unauthenticated
        
        user, membership_status = row

        return CurrentUserResponse(
            id=user.id,
            email=user.email,
            is_admin=user.is_admin,
            is_officer=user.is_officer,
            membership_status=membership_status,
        )


async def logout(session: AsyncSession, token: str | None) -> None:
    digest = session_digest(token)
    if digest is not None:
        async with session.begin():
            await session.execute(delete(Session).where(Session.token_hash == digest))


class EmailAlreadyRegistered(Exception):
    """This email is already registered."""


async def register_account(
    session: AsyncSession, registration: RegistrationRequest
) -> RegistrationResponse:
    
    password_hash = await run_in_threadpool(
        password_hasher.hash, registration.password.get_secret_value()
    )

    try:

        async with session.begin():
            user = User(email=str(registration.email), password_hash=password_hash)
            session.add(user)
            await session.flush()

            membership = Membership(user_id=user.id)
            session.add(membership)
            await session.flush()

            result = RegistrationResponse(
                id=user.id, email=user.email, membership_status=membership.status
            )

        # Both records are saved before returning.
        return result
    
    except IntegrityError as exc:
        database_error = exc.orig.__cause__

        if (
            getattr(database_error, "sqlstate", None) == "23505"
            and getattr(database_error, "constraint_name", None) == "uq_users_email"
        ):
            
            raise EmailAlreadyRegistered from None
        raise
