from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.models import User
from app.modules.ballots.models import Ballot, Option
from app.modules.meetings.models import Meeting
from app.modules.meetings.service import lock_meeting
from app.modules.members.models import Membership, MembershipStatus
from app.modules.nominations.models import Nomination
from app.modules.nominations.schemas import (
    ContestsPage,
    NominationContest,
    NominationCreate,
    NominationResponse,
    NominationsPage,
    NomineeDecision,
    OfficerDecision,
    WindowUpdate,
)


class NominationDenied(Exception):
    pass


class NominationMissing(Exception):
    pass


class NominationConflict(Exception):
    pass


async def approved_member(session: AsyncSession, user_id: UUID) -> None:
    if await session.scalar(select(Membership.status).where(Membership.user_id == user_id)) != (
        MembershipStatus.APPROVED
    ):
        raise NominationDenied("Approved membership is required.")


async def actor(session: AsyncSession, user_id: UUID, *, officer=False, lock=False) -> User:
    statement = select(User).where(User.id == user_id)
    user = await session.scalar(statement.with_for_update() if lock else statement)

    if user is None or user.is_suspended or (officer and not user.is_officer):
        raise NominationDenied("Officer access is required." if officer else "Sign in to continue.")

    return user


async def contest(session: AsyncSession, ballot_id: UUID, *, lock=False) -> Ballot:
    statement = select(Ballot).where(
        Ballot.id == ballot_id, Ballot.kind == "election", Ballot.candidate_source == "nominations"
    )

    if lock:
        meeting_id = await session.scalar(statement.with_only_columns(Ballot.meeting_id))

        if meeting_id is None:
            raise NominationMissing

        await lock_meeting(session, meeting_id)

    ballot = await session.scalar(
        (statement.with_for_update() if lock else statement).execution_options(
            populate_existing=True
        )
    )

    if ballot is None:
        raise NominationMissing

    return ballot


def require_draft(ballot: Ballot) -> None:
    if ballot.state != "DRAFT":
        raise NominationConflict("Candidates cannot change after voting opens.")


async def set_window(session: AsyncSession, user_id: UUID, ballot_id: UUID, data: WindowUpdate):
    async with session.begin():
        await lock_electorate(session)

        await actor(session, user_id, officer=True, lock=True)
        ballot = await contest(session, ballot_id, lock=True)

        require_draft(ballot)

        if ballot.nomination_state == data.state and ballot.revision == data.expected_revision + 1:
            return {"state": ballot.nomination_state, "revision": ballot.revision}

        if ballot.revision != data.expected_revision:
            raise NominationConflict("The contest changed. Refresh before changing nominations.")

        if (ballot.nomination_state, data.state) not in {("NOT_OPEN", "OPEN"), ("OPEN", "CLOSED")}:
            raise NominationConflict("Nominations open once, then close; they cannot reopen.")

        ballot.nomination_state = data.state
        ballot.revision += 1

        await record(
            session,
            AuditAction.NOMINATIONS_OPENED
            if data.state == "OPEN"
            else AuditAction.NOMINATIONS_CLOSED,
            user_id,
            ballot.id,
            meeting_id=ballot.meeting_id,
        )

        await session.flush()

        return {"state": ballot.nomination_state, "revision": ballot.revision}


async def create(session: AsyncSession, user_id: UUID, ballot_id: UUID, data: NominationCreate):
    async with session.begin():
        await lock_electorate(session)
        await approved_member(session, user_id)
        nominee_id = await session.scalar(
            select(User.id)
            .join(Membership, Membership.user_id == User.id)
            .where(
                User.email == str(data.nominee_email).strip().lower(),
                Membership.status == MembershipStatus.APPROVED,
            )
        )

        if nominee_id is None:
            raise NominationConflict("Use the registered email of an approved member.")

        # locking both users before the ballot, including for nomination and audit records

        await session.execute(
            select(User.id)
            .where(User.id.in_([user_id, nominee_id]))
            .order_by(User.id)
            .with_for_update()
        )

        ballot = await contest(session, ballot_id, lock=True)
        require_draft(ballot)

        if ballot.nomination_state != "OPEN":
            raise NominationConflict("This contest is not accepting new nominations.")

        existing = await session.scalar(
            select(Nomination).where(
                Nomination.ballot_id == ballot_id, Nomination.nominee_id == nominee_id
            )
        )

        if existing is not None:
            # returning the existing nomination on retry without changing it
            if existing.nominator_id == user_id:
                return NominationResponse.model_validate(existing)

            raise NominationConflict("This member already has a nomination for this contest.")

        nomination = Nomination(
            ballot_id=ballot_id,
            nominee_id=nominee_id,
            nominator_id=user_id,
            candidate_name=data.candidate_name,
            status="PENDING_REVIEW" if nominee_id == user_id else "PENDING_CONSENT",
        )

        session.add(nomination)
        ballot.revision += 1
        await session.flush()
        await record(
            session,
            AuditAction.NOMINATION_CREATED,
            user_id,
            nomination.id,
            meeting_id=ballot.meeting_id,
        )

        await session.flush()

        return NominationResponse.model_validate(nomination)


async def decide(
    session: AsyncSession,
    user_id: UUID,
    ballot_id: UUID,
    nomination_id: UUID,
    data: NomineeDecision | OfficerDecision,
):
    officer = isinstance(data, OfficerDecision)

    async with session.begin():
        await lock_electorate(session)
        await actor(session, user_id, officer=officer, lock=True)
        ballot = await contest(session, ballot_id, lock=True)
        require_draft(ballot)
        nomination = await session.scalar(
            select(Nomination).where(
                Nomination.id == nomination_id, Nomination.ballot_id == ballot_id
            )
        )

        if nomination is None:
            raise NominationMissing

        if not officer and nomination.nominee_id != user_id:
            raise NominationDenied("Only the nominee can consent or withdraw.")

        if ballot.followup_kind == "runoff" and data.action != "withdraw":
            raise NominationConflict(
                "This runoff nomination is already accepted and approved. You can only withdraw."
            )

        target, action = {
            "accept": ("PENDING_REVIEW", AuditAction.NOMINATION_ACCEPTED),
            "withdraw": ("WITHDRAWN", AuditAction.NOMINATION_WITHDRAWN),
            "approve": ("APPROVED", AuditAction.NOMINATION_APPROVED),
            "reject": ("REJECTED", AuditAction.NOMINATION_REJECTED),
        }[data.action]

        same_name = not isinstance(data, NomineeDecision) or (
            data.action != "accept" or nomination.candidate_name == data.candidate_name
        )

        if (
            nomination.status == target
            and same_name
            and nomination.revision in {data.expected_revision, data.expected_revision + 1}
        ):
            return NominationResponse.model_validate(nomination)

        if nomination.revision != data.expected_revision:
            raise NominationConflict("This nomination changed. Refresh before deciding.")

        if nomination.status in {"WITHDRAWN", "REJECTED"}:
            raise NominationConflict("This nomination is final; it cannot be resubmitted.")

        if data.action == "accept":
            await approved_member(session, user_id)
            nomination.candidate_name = data.candidate_name
        elif data.action == "approve":
            if nomination.status != "PENDING_REVIEW":
                raise NominationConflict("The nominee must consent before officer approval.")

            await approved_member(session, nomination.nominee_id)
            approved = list(
                await session.scalars(
                    select(Nomination.candidate_name).where(
                        Nomination.ballot_id == ballot_id, Nomination.status == "APPROVED"
                    )
                )
            )

            if len(approved) >= 50:
                raise NominationConflict("An election supports at most 50 approved candidates.")

            if nomination.candidate_name.casefold() in {name.casefold() for name in approved}:
                raise NominationConflict(
                    "Another candidate already uses that name. Choose a different name."
                )

        # sending name changes back for officer approval
        nomination.status = target
        nomination.revision += 1
        ballot.revision += 1
        await record(session, action, user_id, nomination.id, meeting_id=ballot.meeting_id)
        await session.flush()

        return NominationResponse.model_validate(nomination)


async def list_contests(
    session: AsyncSession, user_id: UUID, offset: int, limit: int, *, view: str = "all"
):
    async with session.begin():
        if view == "withdraw":
            await actor(session, user_id)
        else:
            await approved_member(session, user_id)

        statement = (
            select(Ballot, Meeting.title)
            .join(Meeting, Meeting.id == Ballot.meeting_id)
            .where(
                Ballot.candidate_source == "nominations",
                Ballot.state.in_(["DRAFT", "CANCELLED"]),
                
                Ballot.nomination_state.in_(["OPEN", "CLOSED"]),
            )
        )

        own = select(Nomination.id).where(Nomination.ballot_id == Ballot.id)

        if view == "withdraw":
            statement = statement.where(own.where(Nomination.nominee_id == user_id).exists())
        elif view == "consent":
            statement = statement.where(Ballot.state == "DRAFT").where(
                own.where(
                    Nomination.nominee_id == user_id, Nomination.status == "PENDING_CONSENT"
                ).exists()
            )

        elif view == "mine":
            statement = statement.where(
                own.where(
                    or_(Nomination.nominee_id == user_id, Nomination.nominator_id == user_id)
                ).exists()
            )

        elif view == "open":
            statement = statement.where(Ballot.nomination_state == "OPEN")

        total = await session.scalar(select(func.count()).select_from(statement.subquery()))
        rows = await session.execute(
            statement.order_by(Ballot.created_at, Ballot.id).offset(offset).limit(limit)
        )

        return ContestsPage(

            items=[
                NominationContest(
                    id=b.id,
                    question=b.question,
                    nomination_state=b.nomination_state,
                    meeting_title=title,
                    ballot_state=b.state,
                    is_runoff=b.followup_kind == "runoff",
                )
                for b, title in rows
            ],

            total=total,
        )


async def list_nominations(
    session: AsyncSession, user_id: UUID, ballot_id: UUID, offset: int, limit: int, *, officer=False
):
    async with session.begin():
        withdrawal_only = False

        if officer:
            await actor(session, user_id, officer=True)
        else:
            await actor(session, user_id)

            withdrawal_only = (
                await session.scalar(select(Membership.status).where(Membership.user_id == user_id))
                != MembershipStatus.APPROVED
            )

            if withdrawal_only and not await session.scalar(
                select(Nomination.id).where(
                    Nomination.ballot_id == ballot_id, Nomination.nominee_id == user_id
                )
            ):
                raise NominationDenied("Only your own existing nominations are available.")

        ballot = await contest(session, ballot_id)

        if not officer and ballot.nomination_state == "NOT_OPEN":
            raise NominationMissing

        scope = [Nomination.ballot_id == ballot_id]

        if withdrawal_only:
            scope.append(Nomination.nominee_id == user_id)
        elif not officer:
            scope.append(or_(Nomination.nominee_id == user_id, Nomination.nominator_id == user_id))

        total = await session.scalar(select(func.count()).select_from(Nomination).where(*scope))

        rows = await session.execute(
            select(Nomination, User.email)
            .join(User, User.id == Nomination.nominee_id)
            .where(*scope)
            .order_by(
                case(
                    (
                        and_(
                            Nomination.nominee_id == user_id, Nomination.status == "PENDING_CONSENT"
                        ),
                        0,
                    ),
                    else_=1,
                ),
                Nomination.created_at,
                Nomination.id,
            )
            .offset(offset)
            .limit(limit)
        )

        return NominationsPage(
            
            items=[
                NominationResponse.model_validate(n).model_copy(
                    update={"nominee_email": email if officer else None}
                )
                for n, email in rows
            ],
            total=total,
        )


async def candidate_options(session: AsyncSession, ballot: Ballot) -> list[Option]:
    """creating candidate options with membership and ballot locks already held

    saving these options and opening voting together, or undoing both on failure
    """

    if ballot.nomination_state != "CLOSED":
        raise NominationConflict("Close nominations before opening voting.")

    rows = (
        await session.execute(
            select(Nomination, Membership.status)
            .outerjoin(Membership, Membership.user_id == Nomination.nominee_id)
            .where(Nomination.ballot_id == ballot.id, Nomination.status == "APPROVED")
            .order_by(Nomination.created_at, Nomination.id)
        )
    ).all()

    if not 2 <= len(rows) <= 50:
        raise NominationConflict("Opening requires 2–50 approved candidates.")

    if any(status != MembershipStatus.APPROVED for _, status in rows):
        raise NominationConflict(
            "An approved candidate is no longer an approved member. Review them."
        )

    names = [n.candidate_name for n, _ in rows]

    if len({name.casefold() for name in names}) != len(names):
        raise NominationConflict("Approved candidates must have different names.")

    if await session.scalar(
        select(func.count()).select_from(Option).where(Option.ballot_id == ballot.id)
    ):
        raise NominationConflict("Add candidates through nominations, not the options field.")

    options = [Option(ballot_id=ballot.id, label=name, position=i) for i, name in enumerate(names)]
    session.add_all(options)
    await session.flush()

    return options
