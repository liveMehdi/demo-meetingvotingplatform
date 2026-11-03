from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.encoding import event_digest, genesis_digest
from app.modules.audit.models import AuditAction, AuditChain, AuditEvent
from app.modules.audit.proof import AuditExport, ChainEvent, Checkpoint, Genesis, verify
from app.modules.audit.schemas import AuditPage, AuditResponse
from app.modules.auth.models import User


class AuditAccessDenied(Exception):
    pass


class AuditExportUnavailable(Exception):
    pass


async def record(
    session: AsyncSession,
    action: AuditAction,
    actor_id: UUID | None,
    target_id: UUID,
    *,
    meeting_id: UUID | None = None,
) -> None:
    
    """Recording the action after app changes, so both save or fail together."""

    if not session.in_transaction():
        raise RuntimeError("Audit write needs a active transaction.")
    
    await session.flush()

    head = await session.scalar(
        select(AuditChain)
        .where(AuditChain.id == 1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if head is None:
        raise RuntimeError("Audit chain missing")
    expected_genesis = genesis_digest(head.chain_id, head.started_at, head.legacy_count)

    tail = (
        await session.scalar(
            select(AuditEvent.event_digest).where(AuditEvent.sequence == head.head_sequence)
        )
        if head.head_sequence
        else head.genesis_digest
    )

    if expected_genesis != head.genesis_digest or tail != head.head_digest:

        raise RuntimeError("Audit chain tail mismatch, write blocked")
    
    fields = dict(
        chain_id=head.chain_id,
        sequence=head.head_sequence + 1,
        previous_digest=head.head_digest,
        id=uuid4(),
        occurred_at=await session.scalar(select(func.clock_timestamp())),
        action=action,
        actor_id=actor_id,
        target_id=target_id,
        meeting_id=meeting_id,
    )

    hashed = event_digest(**fields)

    session.add(AuditEvent(**fields, encoding_version=1, event_digest=hashed))


    head.head_sequence = fields["sequence"]
    head.head_digest = hashed

    await session.flush()



async def list_events(session: AsyncSession, actor_id: UUID, offset: int, limit: int) -> AuditPage:
    async with session.begin():
        if not await session.scalar(
            select(User.is_admin).where(User.id == actor_id, User.is_suspended.is_(False))
        ):
            
            raise AuditAccessDenied
        total = await session.scalar(select(func.count()).select_from(AuditEvent))
        events = await session.scalars(
            select(AuditEvent).order_by(AuditEvent.sequence.desc()).offset(offset).limit(limit)
        )

        return AuditPage(
            items=[AuditResponse.model_validate(event) for event in events],
            total=total,
            offset=offset,
            limit=limit,
        )


async def export_events(session: AsyncSession, actor_id: UUID) -> AuditExport:
    async with session.begin():
        if not await session.scalar(
            select(User.is_admin).where(User.id == actor_id, User.is_suspended.is_(False))
        ):
            
            raise AuditAccessDenied
        head = await session.scalar(
            select(AuditChain).where(AuditChain.id == 1).with_for_update(read=True)
        )
        
        return await build_export(session, head)


async def build_export(session: AsyncSession, head: AuditChain | None) -> AuditExport:
    """Building the export, caller checks permission and keeps  data consistent while reading."""

    if head is None:
        raise AuditExportUnavailable("Audit history is not available. Contact admin.")
    
    if head.head_sequence > 100_000:
        raise AuditExportUnavailable(
            "Audit history exceeds the 100,000-event download limit. "
            "Contact admin. Don't delete any history."
        )
    
    events = await session.scalars(select(AuditEvent).order_by(AuditEvent.sequence))
    bundle = AuditExport(
        genesis=Genesis.model_validate(head),
        checkpoint=Checkpoint(
            chain_id=head.chain_id,
            genesis_digest=head.genesis_digest,
            sequence=head.head_sequence,
            event_digest=head.head_digest,
        ),
        events=[ChainEvent.model_validate(event) for event in events],
    )
    
    verify(bundle)
    return bundle
