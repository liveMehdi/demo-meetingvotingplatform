from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

FORMAL_KINDS = ("election", "motion")
POLL_KINDS = ("poll_single", "poll_multiple")


class Ballot(Base):
    __tablename__ = "ballots"
    __table_args__ = (
        UniqueConstraint("predecessor_id", name="uq_ballots_predecessor"),
        CheckConstraint(
            "(predecessor_id IS NULL AND followup_kind IS NULL) OR "
            "(predecessor_id IS NOT NULL AND predecessor_id <> id "
            "AND followup_kind IS NOT NULL AND "
            "(followup_kind = 'replacement' OR (followup_kind = 'runoff' AND kind = 'election')))",
            name="followup",
        ),

        UniqueConstraint("id", "max_selections", name="uq_ballots_id_selection_limit"),
        CheckConstraint(
            "(invalidated_at IS NULL AND invalidated_by IS NULL AND "
            "invalidation_reason IS NULL) OR "
            "(invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL AND "
            "invalidation_reason IS NOT NULL "
            "AND opened_at IS NOT NULL AND state IN ('CLOSED', 'PUBLISHED') "
            "AND length(btrim(invalidation_reason)) BETWEEN 1 AND 2000)",
            name="invalidation",
        ),
        UniqueConstraint("id", "counting_method", name="uq_ballots_id_counting_method"),

        CheckConstraint(
            "counting_method = 'standard' OR (counting_method = 'irv_v1' AND kind = 'election')",
            name="counting_method",
        ),
        CheckConstraint(
            "kind IN ('election', 'motion', 'poll_single', 'poll_multiple')", name="kind"
        ),
        CheckConstraint(
            "state IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'CANCELLED')", name="state"
        ),
        CheckConstraint(
            "state <> 'CANCELLED' OR (opened_at IS NULL AND opened_by IS NULL AND "
            "closed_at IS NULL AND published_at IS NULL)",
            name="cancelled_unopened",
        ),

        CheckConstraint("length(btrim(question)) > 0", name="question_not_empty"),

        CheckConstraint("length(description) <= 5000", name="description_length"),
        CheckConstraint(
            "(kind IN ('election', 'motion', 'poll_single') "
            "AND min_selections = 1 AND max_selections = 1) OR "
            "(kind = 'poll_multiple' AND min_selections >= 1 AND max_selections >= 2 "
            "AND min_selections <= max_selections AND max_selections <= 50)",
            name="selection_limits",
        ),
        CheckConstraint("revision >= 1", name="revision_positive"),

        CheckConstraint(
            "(candidate_source = 'manual' AND nomination_state = 'NOT_OPEN') OR "
            "(candidate_source = 'nominations' AND kind = 'election' "
            "AND nomination_state IN ('NOT_OPEN', 'OPEN', 'CLOSED'))",
            name="candidate_source",
        ),

        CheckConstraint(
            "eligible_count >= 0 AND eligible_attendance_count >= 0 "
            "AND eligible_attendance_count <= eligible_count",
            name="snapshot_counts",
        ),
        CheckConstraint(
            "eligibility_policy IS NULL OR "
            "eligibility_policy IN ('all_approved', 'attending_approved')",
            name="eligibility_policy",
        ),
        CheckConstraint(
            "(opened_at IS NULL AND opened_by IS NULL AND eligibility_policy IS NULL "
            "AND eligible_count IS NULL AND eligible_attendance_count IS NULL) OR "
            "(opened_at IS NOT NULL AND opened_by IS NOT NULL AND eligibility_policy IS NOT NULL "
            "AND eligible_count IS NOT NULL AND eligible_attendance_count IS NOT NULL) OR "
            "(kind IN ('poll_single', 'poll_multiple') AND opened_at IS NOT NULL "
            "AND opened_by IS NOT NULL AND eligibility_policy IS NULL "
            "AND eligible_count IS NULL AND eligible_attendance_count IS NULL)",
            name="opening_metadata",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meetings.id", ondelete="RESTRICT"), index=True
    )

    predecessor_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT")
    )
    followup_kind: Mapped[str | None] = mapped_column(String(12))

    kind: Mapped[str] = mapped_column(String(20))
    state: Mapped[str] = mapped_column(String(20), server_default="DRAFT")

    question: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, server_default="")

    min_selections: Mapped[int] = mapped_column(Integer, server_default="1")
    max_selections: Mapped[int] = mapped_column(Integer, server_default="1")

    revision: Mapped[int] = mapped_column(Integer, server_default="1")
    counting_method: Mapped[str] = mapped_column(String(20), server_default="standard")

    candidate_source: Mapped[str] = mapped_column(String(20), server_default="manual")
    nomination_state: Mapped[str] = mapped_column(String(10), server_default="NOT_OPEN")

    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))

    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invalidated_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    invalidation_reason: Mapped[str | None] = mapped_column(Text)

    eligibility_policy: Mapped[str | None] = mapped_column(String(30))
    eligible_count: Mapped[int | None] = mapped_column(Integer)
    eligible_attendance_count: Mapped[int | None] = mapped_column(Integer)


class BallotEligibility(Base):
    __tablename__ = "ballot_eligibility"

    ballot_id: Mapped[UUID] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    attended_at_open: Mapped[bool] = mapped_column(Boolean)


class Option(Base):
    __tablename__ = "options"
    __table_args__ = (
        UniqueConstraint("id", "ballot_id", name="uq_options_id_ballot"),
        UniqueConstraint("ballot_id", "position", name="uq_options_ballot_position"),
        UniqueConstraint("ballot_id", "code", name="uq_options_ballot_code"),
        CheckConstraint("position >= 0 AND position < 50", name="position_range"),
        CheckConstraint("length(btrim(label)) > 0", name="label_not_empty"),
        CheckConstraint(
            "code IS NULL OR code IN ('for', 'against', 'abstain')", name="motion_code"
        ),
    )

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )
    ballot_id: Mapped[UUID] = mapped_column(ForeignKey("ballots.id", ondelete="RESTRICT"))

    label: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer)
    code: Mapped[str | None] = mapped_column(String(10))


class ParticipationReceipt(Base):
    __tablename__ = "participation_receipts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["ballot_id", "user_id"],
            ["ballot_eligibility.ballot_id", "ballot_eligibility.user_id"],
            ondelete="RESTRICT",
            name="fk_receipts_eligibility",
        ),
    )

    # recording who submitted, without details linking to their vote.
    ballot_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(primary_key=True)


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("id", "ballot_id", name="uq_votes_id_ballot"),)

    # using a random Id to keep details out
    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )
    ballot_id: Mapped[UUID] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT"), index=True
    )


class VoteChoice(Base):
    __tablename__ = "vote_choices"
    __table_args__ = (
        ForeignKeyConstraint(
            ["ballot_id", "storage_method"],
            ["ballots.id", "ballots.counting_method"],
            name="fk_vote_choices_method",
            ondelete="RESTRICT",
        ),

        CheckConstraint("storage_method = 'standard'", name="storage_method"),

        ForeignKeyConstraint(
            ["vote_id", "ballot_id"],
            ["votes.id", "votes.ballot_id"],
            ondelete="RESTRICT",
            name="fk_vote_choices_vote_ballot",
        ),

        ForeignKeyConstraint(
            ["option_id", "ballot_id"],
            ["options.id", "options.ballot_id"],
            ondelete="RESTRICT",
            name="fk_vote_choices_option_ballot",
        ),
        
        # using ballot choice limit so db rejects extra choices.
        ForeignKeyConstraint(
            ["ballot_id", "selection_limit"],
            ["ballots.id", "ballots.max_selections"],
            ondelete="RESTRICT",
            name="fk_vote_choices_selection_limit",
        ),
        UniqueConstraint("vote_id", "selection_index", name="uq_vote_choices_selection_index"),
        CheckConstraint(
            "selection_index >= 0 AND selection_index < selection_limit", name="selection_index"
        ),
    )

    vote_id: Mapped[UUID] = mapped_column(primary_key=True)
    option_id: Mapped[UUID] = mapped_column(primary_key=True)
    ballot_id: Mapped[UUID] = mapped_column()

    selection_limit: Mapped[int] = mapped_column(Integer, server_default="1")
    selection_index: Mapped[int] = mapped_column(Integer, server_default="0")

    storage_method: Mapped[str] = mapped_column(String(20), server_default="standard")


class VoteRanking(Base):
    __tablename__ = "vote_rankings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["vote_id", "ballot_id"],
            ["votes.id", "votes.ballot_id"],
            name="fk_vote_rankings_vote_ballot",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["option_id", "ballot_id"],
            ["options.id", "options.ballot_id"],
            name="fk_vote_rankings_option_ballot",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["ballot_id", "storage_method"],
            ["ballots.id", "ballots.counting_method"],
            name="fk_vote_rankings_method",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("vote_id", "rank", name="uq_vote_rankings_rank"),
        CheckConstraint("rank >= 1 AND rank <= 50", name="rank"),
        CheckConstraint("storage_method = 'irv_v1'", name="storage_method"),
    )

    vote_id: Mapped[UUID] = mapped_column(primary_key=True)
    option_id: Mapped[UUID] = mapped_column(primary_key=True)
    ballot_id: Mapped[UUID] = mapped_column()

    rank: Mapped[int] = mapped_column(Integer)

    storage_method: Mapped[str] = mapped_column(String(20), server_default="irv_v1")


class RankedResult(Base):
    __tablename__ = "ranked_results"

    ballot_id: Mapped[UUID] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT"), primary_key=True
    )
    payload: Mapped[dict] = mapped_column(JSONB)


class GuestParticipationReceipt(Base):
    __tablename__ = "guest_participation_receipts"

    # recording guest participation separately
    ballot_id: Mapped[UUID] = mapped_column(
        ForeignKey("ballots.id", ondelete="RESTRICT"), primary_key=True
    )
    guest_session_id: Mapped[UUID] = mapped_column(
        ForeignKey("guest_sessions.id", ondelete="RESTRICT"), primary_key=True
    )
