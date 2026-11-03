"""Add officer-created meeting schedules.

Revision ID: 0002_meetings
Revises: 0001_accounts_and_membership
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_meetings"
down_revision = "0001_accounts_and_membership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(btrim(title)) > 0", name=op.f("ck_meetings_title_not_empty")),
        sa.CheckConstraint(
            "length(description) <= 5000", name=op.f("ck_meetings_description_length")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_meetings_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_meetings")),
    )
    op.create_index("ix_meetings_scheduled_at_id", "meetings", ["scheduled_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_meetings_scheduled_at_id", table_name="meetings")
    op.drop_table("meetings")
