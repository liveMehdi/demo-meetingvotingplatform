from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.models import User
from app.modules.meetings.models import Attendance, AttendanceChange, Meeting
from app.modules.meetings.schemas import AttendanceMember, AttendancePage, AttendanceUpdate
from app.modules.meetings.service import (
    MeetingConflict,
    MeetingNotFound,
    OfficerRequired,
    check_officer,
    lock_meeting,
)
from app.modules.members.models import Membership, MembershipStatus


class MemberNotFound(Exception):
    pass


class ApprovalRequired(Exception):
    pass


async def list_attendance(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, offset: int, limit: int
) -> AttendancePage:
    async with session.begin():
        await check_officer(session, actor_id)
        meeting = await session.get(Meeting, meeting_id)

        if meeting is None:
            raise MeetingNotFound

        roster = (
            select(User.id, User.email, Membership.status, Attendance.present, Attendance.revision)
            .join(Membership, Membership.user_id == User.id)
            .outerjoin(
                Attendance,
                and_(Attendance.user_id == User.id, Attendance.meeting_id == meeting_id),
            )
            .where(
                or_(Membership.status == MembershipStatus.APPROVED, Attendance.user_id.is_not(None))
            )
        )

        total = await session.scalar(select(func.count()).select_from(roster.subquery()))

        rows = (
            await session.execute(roster.order_by(User.email, User.id).offset(offset).limit(limit))
        ).all()

        counts = (
            await session.execute(
                select(
                    func.count(),
                    func.count().filter(Membership.status == MembershipStatus.APPROVED),
                )
                .select_from(Attendance)
                .join(Membership, Membership.user_id == Attendance.user_id)
                .where(Attendance.meeting_id == meeting_id, Attendance.present.is_(True))
            )
        ).one()

        return AttendancePage(
            items=[
                AttendanceMember(
                    user_id=id,
                    email=email,
                    membership_status=status,
                    present=bool(present),
                    revision=revision or 0,
                )
                for id, email, status, present, revision in rows
            ],
            total=total,
            offset=offset,
            limit=limit,
            present_count=counts[0],
            approved_present_count=counts[1],
            final_present_count=meeting.final_present_count,
            final_approved_present_count=meeting.final_approved_present_count,
        )


async def set_attendance(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, user_id: UUID, change: AttendanceUpdate
) -> AttendanceMember:
    async with session.begin():
        await lock_electorate(session)

        # locking users in the same order as member management, before meetings and memberships

        users = (

            await session.scalars(
                select(User)
                .where(User.id.in_({actor_id, user_id}))
                .order_by(User.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).all()

        by_id = {user.id: user for user in users}
        actor = by_id.get(actor_id)

        if actor is None or actor.is_suspended or not actor.is_officer:
            raise OfficerRequired

        await lock_meeting(session, meeting_id)

        member = by_id.get(user_id)
        membership = await session.scalar(
            select(Membership)
            .where(Membership.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if member is None or membership is None:
            raise MemberNotFound

        attendance = await session.get(Attendance, (meeting_id, user_id))
        revision = attendance.revision if attendance else 0

        if change.expected_revision != revision and not (
            attendance
            and revision == change.expected_revision + 1

            and attendance.present == change.present
        ):
            raise MeetingConflict(
                "Attendance changed since you loaded it. Review the refreshed record."
            )

        # keeping attendance after approval is removed
        if membership.status != MembershipStatus.APPROVED and (
            change.present or attendance is None
        ):
            raise ApprovalRequired

        changed = attendance is None or attendance.present != change.present

        if attendance is None:
            attendance = Attendance(
                meeting_id=meeting_id,
                user_id=user_id,
                present=change.present,
                recorded_by=actor_id,
                revision=1,
            )
            session.add(attendance)

        elif attendance.present != change.present:
            attendance.present = change.present
            attendance.recorded_by = actor_id
            
            attendance.recorded_at = func.now()
            attendance.revision += 1

        # leaving the record and who last changed it untouched when the request changes nothing
        if changed:
            session.add(
                AttendanceChange(
                    meeting_id=meeting_id,
                    user_id=user_id,
                    revision=attendance.revision,
                    present=change.present,
                    recorded_by=actor_id,
                )
            )

            await record(
                session,
                AuditAction.ATTENDANCE_PRESENT if change.present else AuditAction.ATTENDANCE_ABSENT,
                actor_id,
                user_id,
                meeting_id=meeting_id,
            )

        result = AttendanceMember(
            user_id=user_id,
            email=member.email,
            membership_status=membership.status,
            present=change.present,
            revision=attendance.revision,
        )

    return result


async def attendance_history(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, offset: int, limit: int
):
    from app.modules.meetings.schemas import AttendanceChangeResponse, AttendanceHistory

    async with session.begin():
        await check_officer(session, actor_id)

        if await session.get(Meeting, meeting_id) is None:
            raise MeetingNotFound

        scope = AttendanceChange.meeting_id == meeting_id

        total = await session.scalar(
            select(func.count()).select_from(AttendanceChange).where(scope)

        )

        rows = await session.scalars(
            select(AttendanceChange)
            .where(scope)
            .order_by(
                AttendanceChange.recorded_at.desc(),
                AttendanceChange.user_id,
                AttendanceChange.revision.desc(),
            )
            .offset(offset)
            .limit(limit)
        )

        return AttendanceHistory(
            items=[AttendanceChangeResponse.model_validate(row) for row in rows],
            total=total,
            offset=offset,
            
            limit=limit,
        )
