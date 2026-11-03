"""Manual meeting lifecycle, retained details history and cancellation of unused drafts."""

import sqlalchemy as sa
from alembic import op

revision = "0015_meeting_lifecycle"
down_revision = "0014_audit_chain"
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
    "nominations.opened",
    "nominations.closed",
    "nomination.created",
    "nomination.accepted",
    "nomination.approved",
    "nomination.rejected",
    "nomination.withdrawn",
)
NEW_ACTIONS = OLD_ACTIONS + (
    "meeting.updated",
    "meeting.started",
    "meeting.ended",
    "meeting.cancelled",
    "ballot.cancelled",
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
        "meetings", sa.Column("state", sa.String(12), nullable=False, server_default="PLANNED")
    )
    op.add_column(
        "meetings", sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "meetings",
        sa.Column("needs_status_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    
    for name in ("started_at", "ended_at", "cancelled_at"):
        op.add_column("meetings", sa.Column(name, sa.DateTime(timezone=True)))
    op.create_check_constraint(
        op.f("ck_meetings_state"), "meetings", "state IN ('PLANNED', 'LIVE', 'ENDED', 'CANCELLED')"
    )

    op.create_check_constraint(op.f("ck_meetings_revision_positive"), "meetings", "revision >= 1")
    op.create_check_constraint(
        op.f("ck_meetings_terminal_joining"),
        "meetings",
        "state NOT IN ('ENDED', 'CANCELLED') OR guest_join_code IS NULL",
    )
    op.create_check_constraint(
        op.f("ck_meetings_transition_times"),
        "meetings",
        "(state = 'PLANNED' AND started_at IS NULL AND ended_at IS NULL AND cancelled_at "
        "IS NULL) OR "
        "(state = 'LIVE' AND started_at IS NOT NULL AND ended_at IS NULL AND "
        "cancelled_at IS NULL) OR "
        "(state = 'ENDED' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND "
        "ended_at >= started_at AND cancelled_at IS NULL) OR "
        "(state = 'CANCELLED' AND started_at IS NULL AND ended_at IS NULL AND "
        "cancelled_at IS NOT NULL)",
    )
    op.create_table(
        "meeting_changes",
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("recorded_by", sa.Uuid()),

        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.PrimaryKeyConstraint("meeting_id", "revision", name=op.f("pk_meeting_changes")),
        sa.ForeignKeyConstraint(
            ["meeting_id"],
            ["meetings.id"],
            ondelete="RESTRICT",
            name=op.f("fk_meeting_changes_meeting_id_meetings"),
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by"],
            ["users.id"],
            ondelete="RESTRICT",
            name=op.f("fk_meeting_changes_recorded_by_users"),
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_meeting_changes_revision_positive")),
        sa.CheckConstraint(
            "state IN ('PLANNED', 'LIVE', 'ENDED', 'CANCELLED')",
            name=op.f("ck_meeting_changes_state"),
        ),
        sa.CheckConstraint(
            "kind IN ('created', 'imported', 'edited', 'started', 'ended', 'cancelled')",
            name=op.f("ck_meeting_changes_kind"),
        ),
    )
    op.execute("UPDATE meetings SET needs_status_review = true")
    op.execute(
        "INSERT INTO meeting_changes (meeting_id, revision, title, description, "
        "scheduled_at, state, kind) "
        "SELECT id, revision, title, description, scheduled_at, state, 'imported' FROM meetings"
    )
    op.drop_constraint(op.f("ck_ballots_state"), "ballots", type_="check")
    op.create_check_constraint(
        op.f("ck_ballots_state"),
        "ballots",
        "state IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'CANCELLED')",
    )
    op.create_check_constraint(
        op.f("ck_ballots_cancelled_unopened"),
        "ballots",
        "state <> 'CANCELLED' OR (opened_at IS NULL AND opened_by IS NULL AND closed_at "
        "IS NULL AND published_at IS NULL)",
    )
    audit_actions(NEW_ACTIONS)


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM meeting_changes)
           OR EXISTS (SELECT 1 FROM meetings WHERE state <> 'PLANNED' OR revision <> 1)
           OR EXISTS (SELECT 1 FROM ballots WHERE state = 'CANCELLED')
           OR EXISTS (SELECT 1 FROM audit_events WHERE action IN
             ('meeting.updated', 'meeting.started', 'meeting.ended',
              'meeting.cancelled', 'ballot.cancelled'))
        THEN RAISE EXCEPTION 'Refusing to discard meeting lifecycle/history records'; END IF;
    END $$""")
    audit_actions(OLD_ACTIONS)
    op.drop_constraint(op.f("ck_ballots_cancelled_unopened"), "ballots", type_="check")
    op.drop_constraint(op.f("ck_ballots_state"), "ballots", type_="check")
    op.create_check_constraint(
        op.f("ck_ballots_state"), "ballots", "state IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED')"
    )
    op.drop_table("meeting_changes")

    for name in ("transition_times", "terminal_joining", "revision_positive", "state"):
        op.drop_constraint(op.f(f"ck_meetings_{name}"), "meetings", type_="check")

    for name in (
        "cancelled_at",
        "ended_at",
        "started_at",
        "needs_status_review",
        "revision",
        "state",
    ):
        op.drop_column("meetings", name)
