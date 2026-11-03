from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint("length(btrim(title)) > 0", name="title_not_empty"),
        CheckConstraint("length(description) <= 5000", name="description_length"),
        Index("ix_meetings_scheduled_at_id", "scheduled_at", "id"),

        CheckConstraint(
            "eligibility_policy IN ('all_approved', 'attending_approved')",
            name="eligibility_policy",
        ),

        CheckConstraint("eligibility_revision >= 1", name="eligibility_revision_positive"),
        CheckConstraint("guest_join_revision >= 1", name="guest_join_revision_positive"),
        CheckConstraint("state IN ('PLANNED', 'LIVE', 'ENDED', 'CANCELLED')", name="state"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint(
            "state NOT IN ('ENDED', 'CANCELLED') OR guest_join_code IS NULL",
            name="terminal_joining",
        ),

        CheckConstraint(
            "(state = 'PLANNED' AND started_at IS NULL AND ended_at IS NULL AND "
            "cancelled_at IS NULL) OR "
            "(state = 'LIVE' AND started_at IS NOT NULL AND ended_at IS NULL AND "
            "cancelled_at IS NULL) OR "
            "(state = 'ENDED' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND "
            "ended_at >= started_at AND cancelled_at IS NULL) OR "
            "(state = 'CANCELLED' AND started_at IS NULL AND ended_at IS NULL AND "
            "cancelled_at IS NOT NULL)",
            name="transition_times",
        ),
        
        CheckConstraint(
            "guest_join_code IS NULL OR guest_join_code ~ '^[A-HJ-NP-Z2-9]{10}$'",
            name="guest_join_code_format",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, server_default="")
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    eligibility_policy: Mapped[str] = mapped_column(String(30), server_default="all_approved")
    eligibility_revision: Mapped[int] = mapped_column(Integer, server_default="1")
    eligibility_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    guest_join_code: Mapped[str | None] = mapped_column(String(10), unique=True)
    guest_join_revision: Mapped[int] = mapped_column(Integer, server_default="1")

    state: Mapped[str] = mapped_column(String(12), server_default="PLANNED")
    revision: Mapped[int] = mapped_column(Integer, server_default="1")
    needs_status_review: Mapped[bool] = mapped_column(Boolean, server_default="false")

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    final_present_count: Mapped[int | None] = mapped_column(Integer)
    final_approved_present_count: Mapped[int | None] = mapped_column(Integer)


class MeetingChange(Base):
    __tablename__ = "meeting_changes"
    __table_args__ = (
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("state IN ('PLANNED', 'LIVE', 'ENDED', 'CANCELLED')", name="state"),
        CheckConstraint(
            "kind IN ('created', 'imported', 'edited', 'started', 'ended', 'cancelled')",
            name="kind",
        ),
    )

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="RESTRICT"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    state: Mapped[str] = mapped_column(String(12))
    kind: Mapped[str] = mapped_column(String(12))

    recorded_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (CheckConstraint("revision >= 1", name="revision_positive"),)

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="RESTRICT"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("memberships.user_id", ondelete="RESTRICT"), primary_key=True
    )

    present: Mapped[bool] = mapped_column(Boolean)
    revision: Mapped[int] = mapped_column(Integer, server_default="1")

    recorded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AttendanceChange(Base):
    __tablename__ = "attendance_changes"
    __table_args__ = (CheckConstraint("revision >= 1", name="revision_positive"),)

    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="RESTRICT"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)

    present: Mapped[bool] = mapped_column(Boolean)

    recorded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
