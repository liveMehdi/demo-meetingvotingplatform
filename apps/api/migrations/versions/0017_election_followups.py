"""Retained links from runoff/replacement elections to their predecessors."""

import sqlalchemy as sa
from alembic import op

revision = "0017_election_followups"
down_revision = "0016_creation_requests"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ballots", sa.Column("predecessor_id", sa.Uuid(), nullable=True))
    op.add_column("ballots", sa.Column("followup_kind", sa.String(12), nullable=True))
    op.create_foreign_key(
        "fk_ballots_predecessor_id_ballots",
        "ballots",
        "ballots",
        ["predecessor_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint("uq_ballots_predecessor", "ballots", ["predecessor_id"])
    op.create_check_constraint(
        "followup",
        "ballots",
        "(predecessor_id IS NULL AND followup_kind IS NULL) OR "
        "(predecessor_id IS NOT NULL AND predecessor_id <> id AND kind = 'election' "
        "AND followup_kind IS NOT NULL AND followup_kind IN ('runoff', 'replacement'))",
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM ballots WHERE predecessor_id IS NOT NULL)")
    ):
        raise RuntimeError("Cannot discard retained election follow-up links.")
    op.drop_constraint(op.f("ck_ballots_followup"), "ballots", type_="check")
    op.drop_constraint("uq_ballots_predecessor", "ballots", type_="unique")
    op.drop_constraint("fk_ballots_predecessor_id_ballots", "ballots", type_="foreignkey")
    op.drop_column("ballots", "followup_kind")
    op.drop_column("ballots", "predecessor_id")
