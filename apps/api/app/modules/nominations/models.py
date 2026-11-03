from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Nomination(Base):
    __tablename__ = "nominations"
    __table_args__ = (
        UniqueConstraint("ballot_id", "nominee_id", name="uq_nominations_ballot_nominee"),

        CheckConstraint(
            "status IN ('PENDING_CONSENT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')",
            name="status",
        ),

        CheckConstraint("length(btrim(candidate_name)) > 0", name="candidate_name"),
        CheckConstraint("revision >= 1", name="revision_positive"),
    )

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )
    ballot_id: Mapped[UUID] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT"), index=True
    )
    nominee_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    nominator_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))

    candidate_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))
    
    revision: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
