from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.demo import is_demo_account, protect_demo_account
from app.modules.auth.models import User
from app.modules.members.models import Membership, MembershipStatus
from app.modules.members.schemas import MemberResponse, MembershipUpdate, MembersPage, OfficerUpdate


class AdminRequired(Exception):
    pass


class MemberNotFound(Exception):
    pass


def member_response(
    user: User, status: MembershipStatus | None, *, demo: bool = False
) -> MemberResponse:
    return MemberResponse(
        is_demo_account=demo,
        id=user.id,
        email=user.email,
        is_admin=user.is_admin,
        is_officer=user.is_officer,

        is_suspended=user.is_suspended,
        security_revision=user.security_revision,
        membership_status=status,
        created_at=user.created_at,
    )


async def list_members(
    session: AsyncSession,
    actor_id: UUID,
    offset: int,
    limit: int,
    *,
    view: str = "all",
    q: str = "",
) -> MembersPage:
    async with session.begin():
        if not await session.scalar(
            select(User.is_admin).where(User.id == actor_id, User.is_suspended.is_(False))
        ):
            raise AdminRequired

        statement = select(User, Membership.status).outerjoin(
            Membership, Membership.user_id == User.id
        )

        if view in {"pending", "approved"}:
            statement = statement.where(Membership.status == MembershipStatus(view))
        elif view == "officers":
            statement = statement.where(User.is_officer.is_(True))

        if q.strip():
            statement = statement.where(
                func.lower(User.email).contains(q.strip().lower(), autoescape=True)
            )

        total = await session.scalar(select(func.count()).select_from(statement.subquery()))

        rows = (
            await session.execute(
                statement.order_by(User.created_at, User.id).offset(offset).limit(limit)
            )
        ).all()

        return MembersPage(
            items=[
                member_response(user, status, demo=is_demo_account(session, user))
                for user, status in rows
            ],
            total=total,
            offset=offset,
            limit=limit,
        )


async def lock_target_for_admin(session: AsyncSession, actor_id: UUID, target_id: UUID) -> User:
    # locking both users in the same order, even when admins update each other
    users = (
        await session.scalars(
            select(User)
            .where(User.id.in_({actor_id, target_id}))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).all()

    by_id = {user.id: user for user in users}
    actor = by_id.get(actor_id)

    if actor is None or actor.is_suspended or not actor.is_admin:
        raise AdminRequired

    target = by_id.get(target_id)

    if target is None:
        raise MemberNotFound

    return target


async def update_membership(
    session: AsyncSession, actor_id: UUID, target_id: UUID, change: MembershipUpdate
) -> MemberResponse:
    async with session.begin():
        await lock_electorate(session)

        user = await lock_target_for_admin(session, actor_id, target_id)
        if change.status == "revoked":
            protect_demo_account(session, user)
        
        membership = await session.scalar(
            select(Membership).where(Membership.user_id == target_id).with_for_update()
        )

        if membership is None:
            raise MemberNotFound

        if membership.status != MembershipStatus(change.status):
            membership.status = MembershipStatus(change.status)
            await record(
                session,
                AuditAction.MEMBERSHIP_APPROVED
                if change.status == "approved"
                else AuditAction.MEMBERSHIP_REVOKED,
                actor_id,
                target_id,
            )

        result = member_response(user, membership.status, demo=is_demo_account(session, user))

    return result


async def update_officer(
    session: AsyncSession, actor_id: UUID, target_id: UUID, change: OfficerUpdate
) -> MemberResponse:
    async with session.begin():
        # keeping role changes from clashing with ballot opening, since both lock user records
        await lock_electorate(session)
        user = await lock_target_for_admin(session, actor_id, target_id)

        if not change.is_officer:
            protect_demo_account(session, user)

        if user.is_officer != change.is_officer:
            user.is_officer = change.is_officer
            await record(
                session,
                AuditAction.OFFICER_GRANTED if change.is_officer else AuditAction.OFFICER_REVOKED,
                actor_id,
                target_id,
            )

        status = await session.scalar(
            select(Membership.status).where(Membership.user_id == target_id)
        )
        result = member_response(user, status, demo=is_demo_account(session, user))

    return result
