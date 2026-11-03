from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import and_, delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import creation_requests
from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.ballots.models import (
    FORMAL_KINDS,
    POLL_KINDS,
    Ballot,
    BallotEligibility,
    GuestParticipationReceipt,
    Option,
    ParticipationReceipt,
)
from app.modules.ballots.ranked_results import save_result
from app.modules.ballots.schemas import (
    BallotOpen,
    BallotResponse,
    BallotsPage,
    DraftInput,
    DraftUpdate,
    OptionResponse,
    PollDraftInput,
    PollDraftUpdate,
)
from app.modules.meetings.models import Attendance, Meeting
from app.modules.meetings.service import (
    MeetingNotFound,
    check_officer,
    lock_meeting,
    require_active,
)
from app.modules.members.models import Membership, MembershipStatus
from app.modules.nominations import service as nominations


class BallotNotFound(Exception):
    pass


class DraftConflict(Exception):
    pass


def validate_opening_rules(ballot: Ballot, options: list[Option]) -> None:
    """Checking saved ballot rules before opening, including issues db might miss."""
    try:
        validated = DraftInput(
            kind=ballot.kind,
            question=ballot.question,
            description=ballot.description,
            counting_method=ballot.counting_method or "standard",
            options=[o.label for o in options] if ballot.kind == "election" else [],
        )

    except ValidationError:
        raise DraftConflict("Fix the draft's voting settings before opening it.") from None
    
    if (
        ballot.min_selections != 1
        or ballot.max_selections != 1
        or validated.question != ballot.question
        or validated.description != ballot.description
        or [o.position for o in options] != list(range(len(options)))
    ):
        
        raise DraftConflict("Fix the draft's voting settings before opening it.")
    if ballot.kind == "motion":
        if [(o.label, o.code) for o in options] != [
            ("For", "for"),
            ("Against", "against"),
            ("Abstain", "abstain"),
        ]:
            
            raise DraftConflict("Motions must have For, Against and Abstain options.")
    elif (
        any(o.code is not None for o in options) or [o.label for o in options] != validated.options
    ):
        
        raise DraftConflict("Fix the draft's candidates before opening it.")


def option_rows(ballot_id: UUID, data: DraftInput | PollDraftInput) -> list[Option]:
    labels = (
        [("For", "for"), ("Against", "against"), ("Abstain", "abstain")]

        if data.kind == "motion"
        else [(label, None) for label in data.options]
    )

    return [
        Option(ballot_id=ballot_id, label=label, code=code, position=i)
        for i, (label, code) in enumerate(labels)
    ]


def response(ballot: Ballot, options: list[Option], participation_count: int = 0) -> BallotResponse:
    return BallotResponse(
        invalidated_at=ballot.invalidated_at,
        invalidation_reason=ballot.invalidation_reason,
        id=ballot.id,
        predecessor_id=ballot.predecessor_id,
        followup_kind=ballot.followup_kind,
        meeting_id=ballot.meeting_id,
        kind=ballot.kind,
        state=ballot.state,
        question=ballot.question,
        description=ballot.description,
        revision=ballot.revision,
        candidate_source=ballot.candidate_source,
        counting_method=ballot.counting_method,
        nomination_state=ballot.nomination_state,
        min_selections=ballot.min_selections,
        max_selections=ballot.max_selections,
        options=[OptionResponse.model_validate(option) for option in options],
        opened_at=ballot.opened_at,
        eligibility_policy=ballot.eligibility_policy,
        eligible_count=ballot.eligible_count,
        eligible_attendance_count=ballot.eligible_attendance_count,
        participation_count=participation_count,
        closed_at=ballot.closed_at,
        published_at=ballot.published_at,
    )


async def open_ballot(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID, data: BallotOpen
) -> BallotResponse:
    
    async with session.begin():
        await lock_electorate(session)
        await check_officer(session, actor_id, lock=True)
        meeting = await session.scalar(
            select(Meeting).where(Meeting.id == meeting_id).with_for_update()
        )

        if meeting is None:
            raise BallotNotFound
        
        require_active(meeting)
        ballot = await session.scalar(
            select(Ballot)
            .where(
                Ballot.id == ballot_id,
                Ballot.meeting_id == meeting_id,
                Ballot.kind.in_(FORMAL_KINDS),
            )
            .with_for_update()
        )

        if ballot is None:
            raise BallotNotFound
        
        options = list(
            await session.scalars(
                select(Option).where(Option.ballot_id == ballot_id).order_by(Option.position)
            )
        )

        if meeting.eligibility_revision != data.expected_eligibility_revision:
            raise DraftConflict("The meeting eligibility setting changed. Refresh before opening.")
        # retrying successful opening returns original snapshot

        if (
            ballot.state == "OPEN"
            and ballot.opened_at is not None
            and ballot.revision == data.expected_revision + 1
        ):
            count = await session.scalar(
                select(func.count())
                .select_from(ParticipationReceipt)
                .where(ParticipationReceipt.ballot_id == ballot_id)
            )
            return response(ballot, options, count)
        
        if ballot.state != "DRAFT":
            raise DraftConflict("Only a draft ballot can be opened; closed ballots cannot reopen.")
        
        if ballot.revision != data.expected_revision:
            raise DraftConflict("This draft changed. Review the latest version before opening.")
        
        if ballot.followup_kind == "runoff":
            from app.modules.ballots.followup_service import validate_runoff

            await validate_runoff(session, ballot, options)
            
        if ballot.candidate_source == "nominations":
            try:
                options = await nominations.candidate_options(session, ballot)
            except nominations.NominationConflict as exc:
                raise DraftConflict(str(exc)) from None
            
        validate_opening_rules(ballot, options)
        statement = (
            select(Membership.user_id, func.coalesce(Attendance.present, False))
            .outerjoin(
                Attendance,
                and_(Attendance.user_id == Membership.user_id, Attendance.meeting_id == meeting_id),
            )
            .where(Membership.status == MembershipStatus.APPROVED)
        )

        if meeting.eligibility_policy == "attending_approved":
            statement = statement.where(Attendance.present.is_(True))
        members = (await session.execute(statement)).all()

        if not members:
            raise DraftConflict("No members match this meeting's eligibility setting.")
        
        session.add_all(
            [
                BallotEligibility(ballot_id=ballot_id, user_id=user_id, attended_at_open=present)
                for user_id, present in members
            ]
        )

        opened_at = datetime.now(UTC)

        ballot.state = "OPEN"
        ballot.revision += 1
        ballot.opened_at = opened_at
        ballot.opened_by = actor_id
        ballot.eligibility_policy = meeting.eligibility_policy
        ballot.eligible_count = len(members)
        ballot.eligible_attendance_count = sum(present for _, present in members)

        if meeting.eligibility_locked_at is None:
            meeting.eligibility_locked_at = opened_at

        await record(session, AuditAction.BALLOT_OPENED, actor_id, ballot_id, meeting_id=meeting_id)
        await session.flush()

        result = response(ballot, options)

    return result


async def create_draft(
    session: AsyncSession,
    actor_id: UUID,
    meeting_id: UUID,
    data: DraftInput | PollDraftInput,
    key: UUID | None = None,
) -> BallotResponse:
    
    async with session.begin():

        await check_officer(session, actor_id, lock=True)

        operation = "poll" if isinstance(data, PollDraftInput) else "formal"
        digest = creation_requests.fingerprint(data, meeting_id)
        recovered = await creation_requests.recover(session, actor_id, key, operation, digest)

        if recovered is not None:
            await lock_meeting(session, meeting_id, active=False)
            ballot = await session.scalar(
                select(Ballot).where(Ballot.id == recovered).with_for_update()
            )

            options = list(
                await session.scalars(
                    select(Option).where(Option.ballot_id == recovered).order_by(Option.position)
                )
            )

            receipt = GuestParticipationReceipt if operation == "poll" else ParticipationReceipt

            count = await session.scalar(
                select(func.count()).select_from(receipt).where(receipt.ballot_id == recovered)
            )

            return response(ballot, options, count)
        await lock_meeting(session, meeting_id)

        ballot = Ballot(
            meeting_id=meeting_id,
            kind=data.kind,
            question=data.question,
            description=data.description,
            created_by=actor_id,
            candidate_source=data.candidate_source if isinstance(data, DraftInput) else "manual",
            counting_method=data.counting_method if isinstance(data, DraftInput) else "standard",
            min_selections=data.min_selections if isinstance(data, PollDraftInput) else 1,
            max_selections=data.max_selections if isinstance(data, PollDraftInput) else 1,
        )

        session.add(ballot)

        await session.flush()
        options = option_rows(ballot.id, data)
        session.add_all(options)

        creation_requests.remember(session, actor_id, key, operation, digest, ballot.id)

        await record(
            session, AuditAction.BALLOT_CREATED, actor_id, ballot.id, meeting_id=meeting_id
        )

        await session.flush()

        result = response(ballot, options)
    return result


async def update_draft(
    session: AsyncSession,
    actor_id: UUID,
    meeting_id: UUID,
    ballot_id: UUID,
    data: DraftUpdate | PollDraftUpdate,
) -> BallotResponse:
    
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id)

        ballot = await session.scalar(
            select(Ballot)
            .where(
                Ballot.id == ballot_id,
                Ballot.meeting_id == meeting_id,
                Ballot.kind.in_(POLL_KINDS if isinstance(data, PollDraftInput) else FORMAL_KINDS),
            )
            .with_for_update()

        )

        if ballot is None:
            raise BallotNotFound
        if ballot.predecessor_id is not None and data.kind != ballot.kind:

            raise DraftConflict("A replacement must use the same ballot type.")
        if ballot.followup_kind == "runoff":

            raise DraftConflict(
                "Runoff details and candidates cannot change. Cancel and replace the draft."
            )
        
        if ballot.state != "DRAFT":
            raise DraftConflict("Only draft ballots can be edited.")
        
        if ballot.revision != data.expected_revision:
            raise DraftConflict("This draft changed. Reload it before editing again.")
        
        source = data.candidate_source if isinstance(data, DraftInput) else "manual"
        if source != ballot.candidate_source:

            raise DraftConflict("To change how candidates are added, create a new draft.")
        
        if ballot.candidate_source == "nominations" and ballot.nomination_state != "NOT_OPEN":
            raise DraftConflict("Election details cannot change once nominations open.")
        
        ballot.kind, ballot.question, ballot.description = (
            data.kind,
            data.question,
            data.description,
        )

        ballot.revision += 1
        ballot.min_selections = data.min_selections if isinstance(data, PollDraftInput) else 1
        ballot.counting_method = (
            data.counting_method if isinstance(data, DraftInput) else "standard"
        )

        ballot.max_selections = data.max_selections if isinstance(data, PollDraftInput) else 1
        # option ids are draft-only until opening
        await session.execute(delete(Option).where(Option.ballot_id == ballot_id))
        options = option_rows(ballot_id, data)
        session.add_all(options)
        await record(
            session, AuditAction.BALLOT_UPDATED, actor_id, ballot_id, meeting_id=meeting_id
        )

        await session.flush()
        result = response(ballot, options)

    return result


async def list_ballots(
    session: AsyncSession,
    actor_id: UUID,
    meeting_id: UUID,
    offset: int,
    limit: int,
    *,
    polls: bool = False,
    focus_id: UUID | None = None,
) -> BallotsPage:
    async with session.begin():
        await check_officer(session, actor_id)
        if await session.get(Meeting, meeting_id) is None:
            raise MeetingNotFound
        
        scope = (
            Ballot.meeting_id == meeting_id,
            Ballot.kind.in_(POLL_KINDS if polls else FORMAL_KINDS),
        )

        total = await session.scalar(select(func.count()).select_from(Ballot).where(*scope))

        if focus_id is not None:
            target = await session.scalar(select(Ballot).where(*scope, Ballot.id == focus_id))
            if target is None:
                raise BallotNotFound
            
            preceding = await session.scalar(
                select(func.count())
                .select_from(Ballot)
                .where(
                    *scope,
                    tuple_(Ballot.created_at, Ballot.id) < (target.created_at, target.id),
                )

            )

            offset = (preceding // limit) * limit
        # keeping each question/revision and its option set consistent during the two reads
        ballots = (
            await session.scalars(
                select(Ballot)
                .where(*scope)
                .order_by(Ballot.created_at, Ballot.id)
                .offset(offset)
                .limit(limit)
                .with_for_update(read=True)
            )
        ).all()

        by_id = {ballot.id: [] for ballot in ballots}

        if by_id:
            for option in await session.scalars(
                select(Option).where(Option.ballot_id.in_(by_id)).order_by(Option.position)
            ):
                by_id[option.ballot_id].append(option)

        receipt_model = GuestParticipationReceipt if polls else ParticipationReceipt
        counts = (
            dict(
                (
                    await session.execute(
                        select(receipt_model.ballot_id, func.count())
                        .where(receipt_model.ballot_id.in_(by_id))
                        .group_by(receipt_model.ballot_id)
                    )
                ).all()
            )
            if by_id
            else {}
        )

        return BallotsPage(
            items=[response(b, by_id[b.id], counts.get(b.id, 0)) for b in ballots],
            total=total,
            offset=offset,
            limit=limit,
        )


async def close_ballot(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID
) -> BallotResponse:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id)
        ballot = await session.scalar(
            select(Ballot)
            .where(
                Ballot.id == ballot_id,
                Ballot.meeting_id == meeting_id,
                Ballot.kind.in_(FORMAL_KINDS),
            )
            .with_for_update()
        )

        if ballot is None:
            raise BallotNotFound
        
        if ballot.state not in {"OPEN", "CLOSED"}:
            raise DraftConflict("Only an open ballot can be closed.")
        
        if ballot.state == "OPEN":
            ballot.state = "CLOSED"
            ballot.closed_at = datetime.now(UTC)
            ballot.revision += 1
            await record(
                session, AuditAction.BALLOT_CLOSED, actor_id, ballot_id, meeting_id=meeting_id
            )

        options = list(
            await session.scalars(
                select(Option).where(Option.ballot_id == ballot_id).order_by(Option.position)
            )
        )

        count = await session.scalar(
            select(func.count())
            .select_from(ParticipationReceipt)
            .where(ParticipationReceipt.ballot_id == ballot_id)
        )

        result = response(ballot, options, count)
    return result


async def publish_ballot(
    session: AsyncSession, actor_id: UUID, meeting_id: UUID, ballot_id: UUID
) -> BallotResponse:
    async with session.begin():
        await check_officer(session, actor_id, lock=True)
        await lock_meeting(session, meeting_id, active=False)

        ballot = await session.scalar(
            select(Ballot)
            .where(
                Ballot.id == ballot_id,
                Ballot.meeting_id == meeting_id,
                Ballot.kind.in_(FORMAL_KINDS),
            )
            .with_for_update()
        )

        if ballot is None:
            raise BallotNotFound
        
        if ballot.invalidated_at is not None:
            raise DraftConflict("This ballot is invalidated. New results cannot be published.")
        
        if ballot.state not in {"CLOSED", "PUBLISHED"}:
            raise DraftConflict("Close voting before publishing results.")
        
        if ballot.state == "CLOSED":

            ballot.state = "PUBLISHED"
            ballot.published_at = datetime.now(UTC)
            ballot.published_by = actor_id
            ballot.revision += 1

            if ballot.counting_method == "irv_v1":
                try:
                    await save_result(session, ballot)
                except ValueError:
                    raise DraftConflict(
                        "Rankings failed their checks. Results were not published."
                    ) from None
            await record(
                session, AuditAction.BALLOT_PUBLISHED, actor_id, ballot_id, meeting_id=meeting_id
            )

        options = list(
            await session.scalars(
                select(Option).where(Option.ballot_id == ballot_id).order_by(Option.position)
            )
        )

        count = await session.scalar(
            select(func.count())
            .select_from(ParticipationReceipt)
            .where(ParticipationReceipt.ballot_id == ballot_id)
        )

        result = response(ballot, options, count)
    return result
