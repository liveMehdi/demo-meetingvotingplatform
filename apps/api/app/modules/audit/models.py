from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditAction(StrEnum):
    ADMIN_BOOTSTRAPPED = "admin.bootstrapped"
    ADMIN_GRANTED = "admin.granted"
    ADMIN_REVOKED = "admin.revoked"

    ACCOUNT_SUSPENDED = "account.suspended"
    ACCOUNT_RESTORED = "account.restored"
    SESSIONS_REVOKED = "account.sessions_revoked"
    PASSWORD_RESET_ISSUED = "account.reset_issued"
    PASSWORD_RESET = "account.password_reset"

    MEMBERSHIP_APPROVED = "membership.approved"
    MEMBERSHIP_REVOKED = "membership.revoked"

    OFFICER_GRANTED = "officer.granted"
    OFFICER_REVOKED = "officer.revoked"

    MEETING_CREATED = "meeting.created"
    MEETING_UPDATED = "meeting.updated"
    MEETING_STARTED = "meeting.started"
    MEETING_ENDED = "meeting.ended"
    MEETING_CANCELLED = "meeting.cancelled"

    GUEST_JOINING_ENABLED = "meeting.guest_joining_enabled"
    GUEST_JOINING_DISABLED = "meeting.guest_joining_disabled"

    ELIGIBILITY_ALL = "meeting.eligibility_all_approved"
    ELIGIBILITY_ATTENDING = "meeting.eligibility_attending_approved"

    ATTENDANCE_PRESENT = "attendance.present"
    ATTENDANCE_ABSENT = "attendance.absent"

    BALLOT_CREATED = "ballot.created"
    BALLOT_UPDATED = "ballot.updated"
    BALLOT_OPENED = "ballot.opened"
    BALLOT_CLOSED = "ballot.closed"
    BALLOT_PUBLISHED = "ballot.published"
    BALLOT_CANCELLED = "ballot.cancelled"
    BALLOT_INVALIDATED = "ballot.invalidated"

    NOMINATIONS_OPENED = "nominations.opened"
    NOMINATIONS_CLOSED = "nominations.closed"

    NOMINATION_CREATED = "nomination.created"
    NOMINATION_ACCEPTED = "nomination.accepted"
    NOMINATION_APPROVED = "nomination.approved"
    NOMINATION_REJECTED = "nomination.rejected"
    NOMINATION_WITHDRAWN = "nomination.withdrawn"


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_occurred_at_id", "occurred_at", "id"),
        CheckConstraint("sequence >= 1", name="sequence_positive"),
        CheckConstraint("encoding_version = 1", name="encoding_version"),
        CheckConstraint(
            "previous_digest ~ '^[0-9a-f]{64}$' AND event_digest ~ '^[0-9a-f]{64}$'", name="digests"
        ),
    )

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )

    action: Mapped[AuditAction] = mapped_column(
        Enum(
            AuditAction,
            name="audit_action",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=lambda enum: [value.value for value in enum],
        )
    )
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))

    target_id: Mapped[UUID] = mapped_column()
    meeting_id: Mapped[UUID | None] = mapped_column()

    chain_id: Mapped[UUID] = mapped_column(ForeignKey("audit_chain.chain_id", ondelete="RESTRICT"))
    sequence: Mapped[int] = mapped_column(BigInteger, unique=True)

    encoding_version: Mapped[int] = mapped_column(Integer, server_default="1")
    previous_digest: Mapped[str] = mapped_column(String(64))
    event_digest: Mapped[str] = mapped_column(String(64))


class AuditChain(Base):
    __tablename__ = "audit_chain"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("legacy_count >= 0 AND head_sequence >= legacy_count", name="counts"),
        CheckConstraint(
            "genesis_digest ~ '^[0-9a-f]{64}$' AND head_digest ~ '^[0-9a-f]{64}$'", name="digests"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    chain_id: Mapped[UUID] = mapped_column(unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    legacy_count: Mapped[int] = mapped_column(BigInteger)
    genesis_digest: Mapped[str] = mapped_column(String(64))

    head_sequence: Mapped[int] = mapped_column(BigInteger)
    head_digest: Mapped[str] = mapped_column(String(64))
