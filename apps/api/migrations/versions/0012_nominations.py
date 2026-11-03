"""Nomination-backed elections with consent and officer review."""

import sqlalchemy as sa
from alembic import op

revision = "0012_nominations"
down_revision = "0011_guest_poll_responses"
branch_labels = None
depends_on = None

OLD_ACTIONS = (
    "admin.bootstrapped",
    "membership.approved",
    "membership.revoked",
    "officer.granted",
    "officer.revoked",
    "meeting.created",
    "meeting.guest_joining_enabled",
    "meeting.guest_joining_disabled",
    "meeting.eligibility_all_approved",
    "meeting.eligibility_attending_approved",
    "attendance.present",
    "attendance.absent",
    "ballot.created",
    "ballot.updated",
    "ballot.opened",
    "ballot.closed",
    "ballot.published",
)
NEW_ACTIONS = OLD_ACTIONS + (
    "nominations.opened",
    "nominations.closed",
    "nomination.created",
    "nomination.accepted",
    "nomination.approved",
    "nomination.rejected",
    "nomination.withdrawn",
)


def audit_actions(actions):
    op.drop_constraint(op.f("ck_audit_events_audit_action"), "audit_events", type_="check")
    op.create_check_constraint(
        op.f("ck_audit_events_audit_action"),
        "audit_events",
        "action IN (" + ", ".join(repr(a) for a in actions) + ")",
    )


def upgrade():
    op.add_column(
        "ballots",
        sa.Column("candidate_source", sa.String(20), server_default="manual", nullable=False),
    )
    op.add_column(
        "ballots",
        sa.Column("nomination_state", sa.String(10), server_default="NOT_OPEN", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_ballots_candidate_source"),
        "ballots",
        "(candidate_source = 'manual' AND nomination_state = 'NOT_OPEN') OR "
        "(candidate_source = 'nominations' AND kind = 'election' "
        "AND nomination_state IN ('NOT_OPEN', 'OPEN', 'CLOSED'))",
    )
    op.create_table(
        "nominations",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("ballot_id", sa.Uuid(), nullable=False),
        sa.Column("nominee_id", sa.Uuid(), nullable=False),
        sa.Column("nominator_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nominations")),
        sa.ForeignKeyConstraint(
            ["ballot_id"],
            ["ballots.id"],
            ondelete="RESTRICT",
            name=op.f("fk_nominations_ballot_id_ballots"),
        ),
        sa.ForeignKeyConstraint(
            ["nominee_id"],
            ["users.id"],
            ondelete="RESTRICT",
            name=op.f("fk_nominations_nominee_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["nominator_id"],
            ["users.id"],
            ondelete="RESTRICT",
            name=op.f("fk_nominations_nominator_id_users"),
        ),
        sa.UniqueConstraint("ballot_id", "nominee_id", name="uq_nominations_ballot_nominee"),
        sa.CheckConstraint(
            "status IN ('PENDING_CONSENT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')",
            name=op.f("ck_nominations_status"),
        ),
        sa.CheckConstraint(
            "length(btrim(candidate_name)) > 0", name=op.f("ck_nominations_candidate_name")
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_nominations_revision_positive")),
    )
    op.create_index("ix_nominations_ballot_id", "nominations", ["ballot_id"])
    audit_actions(NEW_ACTIONS)


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM ballots WHERE candidate_source = 'nominations')
            OR EXISTS (SELECT 1 FROM nominations)
            OR EXISTS (SELECT 1 FROM audit_events WHERE action LIKE 'nomination%') THEN
            RAISE EXCEPTION 'Cannot downgrade while nomination data exists';
        END IF;
    END $$""")
    audit_actions(OLD_ACTIONS)
    op.drop_table("nominations")
    op.drop_constraint(op.f("ck_ballots_candidate_source"), "ballots", type_="check")
    op.drop_column("ballots", "nomination_state")
    op.drop_column("ballots", "candidate_source")
