"""Audit format v1: UTF 8 fields in a fixed order, each with its lengthinstead of JSON."""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID


def timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Audit timestamps need a timezone")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def digest(domain: bytes, fields: list[str | None]) -> str:
    encoded = bytearray(domain + b"\x00")
    for field in fields:
        if field is None:
            encoded.extend(b"\x00")
        else:
            data = field.encode("utf-8")
            encoded.extend(b"\x01" + len(data).to_bytes(4, "big") + data)
    return sha256(encoded).hexdigest()


def genesis_digest(chain_id: UUID, started_at: datetime, legacy_count: int) -> str:
    return digest(
        b"voting-audit-genesis-v1", [str(chain_id), timestamp(started_at), str(legacy_count)]
    )


def event_digest(
    *,
    chain_id: UUID,
    sequence: int,
    previous_digest: str,
    id: UUID,
    occurred_at: datetime,
    action: str,
    actor_id: UUID | None,
    target_id: UUID,
    meeting_id: UUID | None,
) -> str:
    return digest(
        b"voting-audit-event-v1",
        [
            str(chain_id),
            str(sequence),
            previous_digest,
            str(id),
            timestamp(occurred_at),
            action,
            str(actor_id) if actor_id else None,
            str(target_id),
            str(meeting_id) if meeting_id else None,
        ],
    )
