"""Add officer-recorded meeting attendance.

Revision ID: 0003_attendance
Revises: 0002_meetings
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_attendance"
down_revision = "0002_meetings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attendance",
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("present", sa.Boolean(), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column(
            "recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"],
            ["meetings.id"],
            name=op.f("fk_attendance_meeting_id_meetings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["memberships.user_id"],
            name=op.f("fk_attendance_user_id_memberships"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by"],
            ["users.id"],
            name=op.f("fk_attendance_recorded_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("meeting_id", "user_id", name=op.f("pk_attendance")),
    )


def downgrade() -> None:
    op.drop_table("attendance")
