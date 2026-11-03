"""Audit export format and checks"""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt

from app.modules.audit.encoding import event_digest, genesis_digest

Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Sequence = Annotated[StrictInt, Field(ge=0)]
Version = Annotated[StrictInt, Field(ge=1, le=1)]


class ProofModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Genesis(ProofModel):
    chain_id: UUID
    started_at: AwareDatetime
    legacy_count: Sequence
    genesis_digest: Hash


class Checkpoint(ProofModel):
    format: Literal["voting-audit-checkpoint-v1"] = "voting-audit-checkpoint-v1"

    chain_id: UUID
    genesis_digest: Hash

    sequence: Sequence
    event_digest: Hash


class ChainEvent(ProofModel):
    id: UUID
    occurred_at: AwareDatetime

    action: Annotated[str, Field(min_length=1, max_length=100)]
    actor_id: UUID | None
    target_id: UUID
    meeting_id: UUID | None

    chain_id: UUID
    sequence: Annotated[StrictInt, Field(ge=1)]

    encoding_version: Version = 1
    previous_digest: Hash
    event_digest: Hash


class AuditExport(ProofModel):
    format: Literal["voting-audit-export-v1"] = "voting-audit-export-v1"

    genesis: Genesis
    checkpoint: Checkpoint
    events: list[ChainEvent]


class VerificationError(ValueError):
    """Verification errors with no input data in the message."""


def verify(export: AuditExport, trusted: Checkpoint | None = None) -> dict:
    genesis = export.genesis


    root = genesis_digest(genesis.chain_id, genesis.started_at, genesis.legacy_count)

    if root != genesis.genesis_digest:
        raise VerificationError("Genesis hash mismatch.")
    
    if genesis.legacy_count > len(export.events):
        raise VerificationError("Export is missing legacy history.")

    previous = root
    anchored = trusted is not None and trusted.sequence == 0 and trusted.event_digest == root

    
    if trusted is not None and (
        trusted.chain_id != genesis.chain_id or trusted.genesis_digest != root
    ):
        raise VerificationError("Trusted checkpoint chain mismatch.")

    ids = set()
    for sequence, event in enumerate(export.events, 1):
        if (
            event.chain_id != genesis.chain_id
            or event.sequence != sequence
            or event.previous_digest != previous
        ):
            raise VerificationError("Event sequence, chain ID or previous hash mismatch.")

        if event.id in ids:
            raise VerificationError("Duplicate event ID")
        ids.add(event.id)

        fields = event.model_dump(exclude={"event_digest", "encoding_version"})
        hashed = event_digest(**fields)
        if hashed != event.event_digest:
            raise VerificationError("Event hash mismatch.")

        if trusted is not None and sequence == trusted.sequence:
            anchored = hashed == trusted.event_digest

        previous = hashed

    expected = Checkpoint(
        chain_id=genesis.chain_id,
        genesis_digest=root,
        sequence=len(export.events),
        event_digest=previous,
    )
    if export.checkpoint != expected:
        raise VerificationError("Export checkpoint/end mismatch.")
    if trusted is not None and not anchored:
        raise VerificationError("Trusted checkpoint mismatch, history may be missing or replaced.")

    return dict(
        events=len(export.events),
        legacy_events=genesis.legacy_count,
        anchored_through=trusted.sequence if trusted is not None else None,
        unanchored_events=len(export.events) - trusted.sequence
        if trusted is not None
        else len(export.events),
    )
