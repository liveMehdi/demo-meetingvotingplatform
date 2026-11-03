"""Attendance history, account security/recovery and retained ballot invalidation."""

import sqlalchemy as sa
from alembic import op

revision = "0018_reliability"
down_revision = "0017_election_followups"
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
    "meeting.updated",
    "meeting.started",
    "meeting.ended",
    "meeting.cancelled",
    "ballot.cancelled",
)
NEW_ACTIONS = (
    "admin.granted",
    "admin.revoked",
    "account.suspended",
    "account.restored",
    "account.sessions_revoked",
    "account.reset_issued",
    "account.password_reset",
    "ballot.invalidated",
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
        "attendance", sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_check_constraint("revision_positive", "attendance", "revision >= 1")
    op.create_table(
        "attendance_changes",
        sa.Column(
            "meeting_id",
            sa.Uuid(),
            sa.ForeignKey("meetings.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
        ),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("present", sa.Boolean(), nullable=False),
        sa.Column(
            "recorded_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.CheckConstraint("revision >= 1", name="revision_positive"),
    )
    op.execute(
        "INSERT INTO attendance_changes (meeting_id, user_id, revision, present, "
        "recorded_by, recorded_at) "
        "SELECT meeting_id, user_id, revision, present, recorded_by, recorded_at FROM attendance"
    )
    op.add_column("meetings", sa.Column("final_present_count", sa.Integer()))
    op.add_column("meetings", sa.Column("final_approved_present_count", sa.Integer()))
    op.add_column(
        "users", sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "users", sa.Column("security_revision", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_table(
        "password_resets",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("token_hash ~ '^[0-9a-f]{64}$'", name="token_hash_format"),
    )
    op.add_column("ballots", sa.Column("invalidated_at", sa.DateTime(timezone=True)))
    op.add_column("ballots", sa.Column("invalidated_by", sa.Uuid()))
    op.add_column("ballots", sa.Column("invalidation_reason", sa.Text()))
    op.create_foreign_key(
        "fk_ballots_invalidated_by_users",
        "ballots",
        "users",
        ["invalidated_by"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "invalidation",
        "ballots",
        "(invalidated_at IS NULL AND invalidated_by IS NULL AND invalidation_reason IS NULL) OR "
        "(invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL AND "
        "invalidation_reason IS NOT NULL "
        "AND opened_at IS NOT NULL AND state IN ('CLOSED', 'PUBLISHED') "
        "AND length(btrim(invalidation_reason)) BETWEEN 1 AND 2000)",
    )
    op.drop_constraint(op.f("ck_ballots_followup"), "ballots", type_="check")
    op.create_check_constraint(
        "followup",
        "ballots",
        "(predecessor_id IS NULL AND followup_kind IS NULL) OR "
        "(predecessor_id IS NOT NULL AND predecessor_id <> id AND followup_kind IS NOT NULL AND "
        "(followup_kind = 'replacement' OR (followup_kind = 'runoff' AND kind = 'election')))",
    )
    audit_actions(OLD_ACTIONS + NEW_ACTIONS)


def downgrade():
    for table, where in [
        ("audit_events", "action IN (" + ", ".join(repr(a) for a in NEW_ACTIONS) + ")"),
        ("password_resets", "true"),
        (
            "ballots",
            "invalidated_at IS NOT NULL OR (predecessor_id IS NOT NULL AND kind <> 'election')",
        ),
        ("meetings", "final_present_count IS NOT NULL"),
        ("users", "is_suspended OR security_revision > 1"),
    ]:
        if op.get_bind().scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE {where})")):
            raise RuntimeError("Cannot discard retained reliability/security history.")
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM attendance_changes)")):
        raise RuntimeError("Cannot discard retained attendance history.")
    audit_actions(OLD_ACTIONS)
    op.drop_constraint(op.f("ck_ballots_followup"), "ballots", type_="check")
    op.create_check_constraint(
        "followup",
        "ballots",
        "(predecessor_id IS NULL AND followup_kind IS NULL) OR "
        "(predecessor_id IS NOT NULL AND predecessor_id <> id AND kind = 'election' "
        "AND followup_kind IS NOT NULL AND followup_kind IN ('runoff', 'replacement'))",
    )
    op.drop_constraint(op.f("ck_ballots_invalidation"), "ballots", type_="check")
    op.drop_constraint("fk_ballots_invalidated_by_users", "ballots", type_="foreignkey")
    for column in ("invalidated_at", "invalidated_by", "invalidation_reason"):
        op.drop_column("ballots", column)
    op.drop_table("password_resets")
    op.drop_column("users", "security_revision")
    op.drop_column("users", "is_suspended")
    op.drop_column("meetings", "final_approved_present_count")
    op.drop_column("meetings", "final_present_count")
    op.drop_table("attendance_changes")
    op.drop_constraint(op.f("ck_attendance_revision_positive"), "attendance", type_="check")
    op.drop_column("attendance", "revision")
