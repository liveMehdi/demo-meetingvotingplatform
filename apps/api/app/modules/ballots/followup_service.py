"""Creating followup elections with no copy of original votes."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import creation_requests
from app.db.electorate_lock import lock_electorate
from app.modules.audit.models import AuditAction
from app.modules.audit.service import record
from app.modules.auth.models import User
from app.modules.ballots import service
from app.modules.ballots.followup_schemas import ElectionLink, FollowupCreate, FollowupPreview
from app.modules.ballots.models import (
    POLL_KINDS,
    Ballot,
    GuestParticipationReceipt,
    Option,
    ParticipationReceipt,
    RankedResult,
    VoteChoice,
)
from app.modules.meetings.service import check_officer, lock_meeting, require_active
from app.modules.nominations.models import Nomination


def link(ballot: Ballot | None):
    return (
        None if ballot is None

        else ElectionLink(
            kind=ballot.kind,
            invalidated_at=ballot.invalidated_at.isoformat() if ballot.invalidated_at else None,
            id=ballot.id,
            meeting_id=ballot.meeting_id,
            question=ballot.question,
            state=ballot.state,
        )
    )


async def options_for(session, ballot_id):
    return list(
        await session.scalars(
            select(Option).where(Option.ballot_id == ballot_id).order_by(Option.position)
        )
    )


async def roster(session: AsyncSession, source: Ballot) -> list[Option]:
    if source.kind != "election" or source.state != "PUBLISHED" or source.invalidated_at:
        return []
    
    options = await options_for(session, source.id)

    if source.counting_method == "irv_v1":
        saved = await session.get(RankedResult, source.id)

        if saved is None or saved.payload.get("outcome") != "unresolved_tie":
            return []
        
        leaders = {UUID(value) for value in saved.payload["leading_option_ids"]}
    else:
        rows = (
            await session.execute(
                select(Option.id, func.count(VoteChoice.vote_id))
                .outerjoin(
                    VoteChoice,
                    (VoteChoice.option_id == Option.id) & (VoteChoice.ballot_id == source.id),
                )
                .where(Option.ballot_id == source.id)
                .group_by(Option.id)
            )
        ).all()

        highest = max((count for _, count in rows), default=0)
        leaders = {option for option, count in rows if count == highest} if highest else set()

    return [option for option in options if option.id in leaders] if len(leaders) >= 2 else []


async def source_nominations(session, source, candidates):

    rows = list(
        await session.scalars(
            select(Nomination).where(
                Nomination.ballot_id == source.id, Nomination.status == "APPROVED"
            )
        )
    )

    by_name = {row.candidate_name: row for row in rows}

    if any(option.label not in by_name for option in candidates):
        raise service.DraftConflict(
            "The original candidate records are unavailable. Review the election history."
        )
    
    return [by_name[option.label] for option in candidates]


async def preview(session, actor_id, source_id):

    async with session.begin():
        await check_officer(session, actor_id)
        source = await session.get(Ballot, source_id)
        if source is None:
            raise service.BallotNotFound
        
        candidates = await roster(session, source)
        kind = (
            "runoff"
            if candidates
            else "replacement"
            if source.invalidated_at
            or (
                source.kind == "election"
                and source.state == "CANCELLED"
                and source.opened_at is None
            )
            else None
        )

        if kind == "replacement" and source.candidate_source == "manual":
            candidates = await options_for(session, source.id)

        successor = await session.scalar(select(Ballot).where(Ballot.predecessor_id == source_id))
        predecessor = (
            await session.get(Ballot, source.predecessor_id) if source.predecessor_id else None
        )

        return FollowupPreview(
            source=link(source),
            revision=source.revision,
            kind=kind,
            candidates=[o.label for o in candidates],
            candidate_source=source.candidate_source,
            counting_method=source.counting_method,
            predecessor=link(predecessor),
            successor=link(successor),
        )


async def validate_runoff(session, ballot, options):
    """Called before opening, under electorate/meeting/ballot locks."""
    source = await session.get(Ballot, ballot.predecessor_id)
    candidates = await roster(session, source) if source else []
    if not candidates or (
        ballot.question,
        ballot.description,
        ballot.counting_method,
        ballot.candidate_source,
    ) != (source.question, source.description, source.counting_method, source.candidate_source):
        raise service.DraftConflict("Runoff rules do not match the original election.")
    
    if ballot.candidate_source == "manual":
        if [o.label for o in options] != [o.label for o in candidates]:
            raise service.DraftConflict("The runoff must contain exactly the required candidates.")
        
    else:
        original = await source_nominations(session, source, candidates)
        current = list(
            await session.scalars(select(Nomination).where(Nomination.ballot_id == ballot.id))
        )

        expected = {(n.nominee_id, n.candidate_name, "APPROVED") for n in original}
        if {(n.nominee_id, n.candidate_name, n.status) for n in current} != expected:
            raise service.DraftConflict(
                "A required runoff candidate is unavailable. "
                "Cancel this draft and create a replacement."
            )
        
        # candidate_options also rechecks current approved membership before any opening writes.


async def create(session, actor_id, source_id, data: FollowupCreate, key: UUID):
    async with session.begin():

        await lock_electorate(session)
        await check_officer(session, actor_id)
        source = await session.get(Ballot, source_id)

        if source is None:
            raise service.BallotNotFound
        
        candidates = await roster(session, source) if data.kind == "runoff" else []

        copied = (
            await source_nominations(session, source, candidates)
            if candidates and source.candidate_source == "nominations"
            else []
        )

        # Protect implicit nomination FKs before taking meeting/ballot locks.
        users = {actor_id} | {n.nominee_id for n in copied} | {n.nominator_id for n in copied}
        await session.execute(
            select(User.id).where(User.id.in_(users)).order_by(User.id).with_for_update()
        )
        await check_officer(session, actor_id, lock=True)
        digest = creation_requests.fingerprint(data, source_id)
        recovered = await creation_requests.recover(session, actor_id, key, "formal", digest)
        # stable ordering also covers a source in a different meeting.
        locked = {}

        for meeting_id in sorted({source.meeting_id, data.meeting_id}):
            locked[meeting_id] = await lock_meeting(session, meeting_id, active=False)

        source = await session.scalar(
            select(Ballot)
            .where(Ballot.id == source_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if recovered:
            target = await session.get(Ballot, recovered)
            receipt = (
                GuestParticipationReceipt if target.kind in POLL_KINDS else ParticipationReceipt
            )

            count = await session.scalar(
                select(func.count()).select_from(receipt).where(receipt.ballot_id == recovered)
            )

            return service.response(target, await options_for(session, recovered), count)
        
        require_active(locked[data.meeting_id])

        if (
            locked[data.meeting_id].revision != data.expected_meeting_revision
            or source.revision != data.expected_revision
        ):
            
            raise service.DraftConflict(
                "The original ballot or selected meeting changed. Review your selection."
            )
        
        if await session.scalar(select(Ballot.id).where(Ballot.predecessor_id == source_id)):
            raise service.DraftConflict(
                "This ballot already has a follow-up. Open it from the ballot history."
            )
        
        if data.kind == "runoff" and not candidates:
            raise service.DraftConflict("A runoff requires published tied election results.")
        
        if data.kind == "replacement" and not (
            source.invalidated_at
            or (
                source.kind == "election"
                and source.state == "CANCELLED"
                and source.opened_at is None
            )
        ):
            
            raise service.DraftConflict(
                "Only invalidated ballots or cancelled, never-opened elections can be replaced."
            )
        
        target = Ballot(
            meeting_id=data.meeting_id,
            kind=source.kind,
            min_selections=source.min_selections,
            max_selections=source.max_selections,
            question=source.question,
            description=source.description,
            created_by=actor_id,
            counting_method=source.counting_method,
            candidate_source=source.candidate_source,
            nomination_state="CLOSED" if copied else "NOT_OPEN",
            predecessor_id=source.id,
            followup_kind=data.kind,
        )

        session.add(target)
        await session.flush()
        options = []

        if source.candidate_source == "manual":
            labels = candidates if data.kind == "runoff" else await options_for(session, source.id)
            options = [
                Option(ballot_id=target.id, label=o.label, code=o.code, position=i)
                for i, o in enumerate(labels)
            ]

            session.add_all(options)

        for original in copied:
            session.add(
                Nomination(
                    ballot_id=target.id,
                    nominee_id=original.nominee_id,
                    nominator_id=original.nominator_id,
                    candidate_name=original.candidate_name,
                    status="APPROVED",
                )
            )

        creation_requests.remember(session, actor_id, key, "formal", digest, target.id)
        
        await record(
            session, AuditAction.BALLOT_CREATED, actor_id, target.id, meeting_id=target.meeting_id
        )
        return service.response(target, options)
