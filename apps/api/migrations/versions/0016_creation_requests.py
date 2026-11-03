"""Actor-scoped retry keys for meeting and draft creation."""

import sqlalchemy as sa
from alembic import op

revision = "0016_creation_requests"
down_revision = "0015_meeting_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "creation_requests",
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(10), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("actor_id", "key"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("operation IN ('meeting', 'formal', 'poll')", name="operation"),
        sa.CheckConstraint("payload_hash ~ '^[0-9a-f]{64}$'", name="payload_hash"),
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM creation_requests)")):
        raise RuntimeError("Cannot discard retained creation retry keys.")
    op.drop_table("creation_requests")
