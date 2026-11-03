"""Retry protection for officer preparation only, don't use for vote submissions."""

import hashlib
import json
from typing import Annotated
from uuid import UUID

from fastapi import Header
from pydantic import BaseModel
from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

CreationKey = Annotated[UUID | None, Header(alias="Idempotency-Key")]


class CreationConflict(Exception):
    pass


class CreationRequest(Base):
    __tablename__ = "creation_requests"
    __table_args__ = (
        CheckConstraint("operation IN ('meeting', 'formal', 'poll')", name="operation"),
        CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="payload_hash"),
    )

    actor_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    key: Mapped[UUID] = mapped_column(primary_key=True)
    operation: Mapped[str] = mapped_column(String(10))
    payload_hash: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[UUID] = mapped_column()


def fingerprint(data: BaseModel, meeting_id: UUID | None = None) -> str:
    payload = [str(meeting_id) if meeting_id else None, data.model_dump(mode="json")]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def recover(
    session: AsyncSession, actor: UUID, key: UUID | None, operation: str, digest: str
) -> UUID | None:
    # Caller must lock the user row so their requests run one at a time
    if key is None:
        return None
    existing = await session.get(CreationRequest, (actor, key))
    if existing is None:
        return None
    if existing.operation != operation or existing.payload_hash != digest:
        raise CreationConflict(
            "This retry doesn't match the original attempt, use the original details."
        )
    return existing.resource_id


def remember(
    session: AsyncSession,
    actor: UUID,
    key: UUID | None,
    operation: str,
    digest: str,
    resource: UUID,
):
    if key is not None:
        session.add(
            CreationRequest(
                actor_id=actor,
                key=key,
                operation=operation,
                payload_hash=digest,
                resource_id=resource,
            )
        )
