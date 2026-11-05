"""Admin-assisted password resets for demo efficiency"""

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.demo import is_demo_account, protect_demo_account
from app.modules.auth.models import PasswordReset, Session, User
from app.modules.auth.service import password_hasher, session_digest
from app.modules.members.models import Membership
from app.modules.members.schemas import SecurityUpdate
from app.modules.members.service import lock_target_for_admin, member_response


class SecurityConflict(Exception):
    pass


async def manage_account(
    session: AsyncSession, actor_id: UUID, target_id: UUID, data: SecurityUpdate
):
    async with session.begin():
        # also serialising the competing last admin removals

        await lock_electorate(session)
        user = await lock_target_for_admin(session, actor_id, target_id)
        protect_demo_account(session, user)
        if user.security_revision != data.expected_revision:
            raise SecurityConflict("Account controls changed. Refresh before trying again.")

        if data.action in {"suspend", "remove_admin"} and user.is_admin and not user.is_suspended:
            others = await session.scalar(
                select(func.count())
                .select_from(User)
                .where(User.is_admin.is_(True), User.is_suspended.is_(False), User.id != target_id)
            )

            if not others:
                raise SecurityConflict("Keep at least one active administrator.")

        if data.action == "issue_reset" and user.is_suspended:
            raise SecurityConflict("Restore this account before issuing a recovery code.")

        token = None
        expires_at = None

        if data.action in {"suspend", "restore"}:
            user.is_suspended = data.action == "suspend"

        if data.action in {"grant_admin", "remove_admin"}:
            user.is_admin = data.action == "grant_admin"

        if data.action in {"suspend", "revoke_sessions", "issue_reset"}:
            await session.execute(delete(Session).where(Session.user_id == target_id))
            await session.execute(delete(PasswordReset).where(PasswordReset.user_id == target_id))

        if data.action == "issue_reset":
            token = secrets.token_urlsafe(32)
            expires_at = await session.scalar(select(func.clock_timestamp())) + timedelta(
                minutes=15
            )
            session.add(
                PasswordReset(
                    user_id=target_id, token_hash=session_digest(token), expires_at=expires_at
                )
            )

        user.security_revision += 1
        status = await session.scalar(
            select(Membership.status).where(Membership.user_id == target_id)
        )

        await record(
            session,
            {
                "suspend": AuditAction.ACCOUNT_SUSPENDED,
                "restore": AuditAction.ACCOUNT_RESTORED,
                "grant_admin": AuditAction.ADMIN_GRANTED,
                "remove_admin": AuditAction.ADMIN_REVOKED,
                "revoke_sessions": AuditAction.SESSIONS_REVOKED,
                "issue_reset": AuditAction.PASSWORD_RESET_ISSUED,
            }[data.action],
            actor_id,
            target_id,
            
        )
        return {
            "member": member_response(user, status, demo=is_demo_account(session, user)),
            "reset_code": token,
            "expires_at": expires_at,
        }


async def reset_password(session: AsyncSession, code: str, password: str):
    digest = session_digest(code)
    if digest is None:
        raise SecurityConflict("The recovery code is invalid or expired.")
    
    async with session.begin():
        user_id = await session.scalar(
            select(PasswordReset.user_id).where(
                PasswordReset.token_hash == digest,
                PasswordReset.expires_at > func.clock_timestamp(),
            )
        )

    if user_id is None:
        raise SecurityConflict("The recovery code is invalid or expired.")
    
    hashed = await run_in_threadpool(password_hasher.hash, password)

    async with session.begin():
        user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
        reset = await session.scalar(
            select(PasswordReset)
            .where(
                PasswordReset.token_hash == digest,
                PasswordReset.expires_at > func.clock_timestamp(),
            )
            .with_for_update()
        )

        if reset is None or user is None or user.is_suspended:
            raise SecurityConflict("The recovery code is invalid or expired.")

        # blocking older recovery codes too, even if they predate demo protection
        protect_demo_account(session, user)
        
        user.password_hash = hashed
        user.security_revision += 1
        
        await session.delete(reset)
        await session.execute(delete(Session).where(Session.user_id == user_id))
        await record(session, AuditAction.PASSWORD_RESET, user_id, user_id)
