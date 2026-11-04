from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.modules.audit.encoding import event_digest, genesis_digest
from app.modules.audit.proof import (
    AuditExport,
    ChainEvent,
    Checkpoint,
    Genesis,
    VerificationError,
    verify,
)


@pytest.fixture
def bundle():
    chain_id = UUID(int=2)
    now = datetime(2026, 1, 1, tzinfo=UTC)

    root = genesis_digest(chain_id, now, 0)
    previous = root

    events = []

    for sequence in (1, 2, 3):
        fields = dict(
            chain_id=chain_id,
            sequence=sequence,
            previous_digest=previous,
            id=UUID(int=sequence + 10),
            occurred_at=now,
            action="meeting.created",
            actor_id=None,
            target_id=UUID(int=20 + sequence),
            meeting_id=None,
        )

        previous = event_digest(**fields)
        events.append(ChainEvent(**fields, event_digest=previous))

    return AuditExport(
        genesis=Genesis(chain_id=chain_id, started_at=now, legacy_count=0, genesis_digest=root),
        checkpoint=Checkpoint(
            chain_id=chain_id,
            genesis_digest=root,
            sequence=3,
            event_digest=previous,
        ),
        events=events,
    )


def test_valid_export_matches_retained_checkpoint(bundle):
    result = verify(bundle, bundle.checkpoint)

    assert result["anchored_through"] == 3
    assert result["unanchored_events"] == 0


@pytest.mark.parametrize("change", ["edit", "delete", "reorder"])
def test_changed_audit_history_is_rejected(bundle, change):
    corrupted = bundle.model_copy(deep=True)

    if change == "edit":
        corrupted.events[0].action = "meeting.ended"
    elif change == "delete":
        corrupted.events.pop(1)
    else:
        corrupted.events.reverse()

    with pytest.raises(VerificationError):
        verify(corrupted, bundle.checkpoint)


def test_truncation_with_recomputed_export_checkpoint_is_rejected(bundle):
    truncated = bundle.model_copy(deep=True)

    truncated.events.pop()

    truncated.checkpoint.sequence = 2

    truncated.checkpoint.event_digest = truncated.events[-1].event_digest

    # the shorter history looks valid until we compare it with the saved checkpoint
    verify(truncated)

    with pytest.raises(VerificationError, match="Trusted checkpoint"):
        verify(truncated, bundle.checkpoint)


def test_rehashed_history_cannot_match_the_retained_checkpoint(bundle):
    rewritten = bundle.model_copy(deep=True)
    rewritten.events[0].action = "meeting.ended"
    previous = rewritten.genesis.genesis_digest

    for event in rewritten.events:
        event.previous_digest = previous

        event.event_digest = event_digest(
            **event.model_dump(exclude={"event_digest", "encoding_version"})
        )

        previous = event.event_digest

    rewritten.checkpoint.event_digest = previous

    verify(rewritten)

    with pytest.raises(VerificationError, match="Trusted checkpoint"):
        verify(rewritten, bundle.checkpoint)
