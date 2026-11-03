"""Explicit IRV policy, separate ordered preferences and immutable published aggregates."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_ranked_elections"
down_revision = "0012_nominations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ballots",
        sa.Column("counting_method", sa.String(20), server_default="standard", nullable=False),
    )
    op.create_unique_constraint(
        "uq_ballots_id_counting_method", "ballots", ["id", "counting_method"]
    )
    op.create_check_constraint(
        op.f("ck_ballots_counting_method"),
        "ballots",
        "counting_method = 'standard' OR (counting_method = 'irv_v1' AND kind = 'election')",
    )
    op.add_column(
        "vote_choices",
        sa.Column("storage_method", sa.String(20), server_default="standard", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_vote_choices_storage_method"), "vote_choices", "storage_method = 'standard'"
    )
    op.create_foreign_key(
        "fk_vote_choices_method",
        "vote_choices",
        "ballots",
        ["ballot_id", "storage_method"],
        ["id", "counting_method"],
        ondelete="RESTRICT",
    )
    op.create_table(
        "vote_rankings",
        sa.Column("vote_id", sa.Uuid(), nullable=False),
        sa.Column("option_id", sa.Uuid(), nullable=False),
        sa.Column("ballot_id", sa.Uuid(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("storage_method", sa.String(20), server_default="irv_v1", nullable=False),
        sa.PrimaryKeyConstraint("vote_id", "option_id", name=op.f("pk_vote_rankings")),
        sa.ForeignKeyConstraint(
            ["vote_id", "ballot_id"],
            ["votes.id", "votes.ballot_id"],
            name="fk_vote_rankings_vote_ballot",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["option_id", "ballot_id"],
            ["options.id", "options.ballot_id"],
            name="fk_vote_rankings_option_ballot",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ballot_id", "storage_method"],
            ["ballots.id", "ballots.counting_method"],
            name="fk_vote_rankings_method",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("vote_id", "rank", name="uq_vote_rankings_rank"),
        sa.CheckConstraint("rank >= 1 AND rank <= 50", name=op.f("ck_vote_rankings_rank")),
        sa.CheckConstraint(
            "storage_method = 'irv_v1'", name=op.f("ck_vote_rankings_storage_method")
        ),
    )
    op.create_table(
        "ranked_results",
        sa.Column("ballot_id", sa.Uuid(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.PrimaryKeyConstraint("ballot_id", name=op.f("pk_ranked_results")),
        sa.ForeignKeyConstraint(
            ["ballot_id"],
            ["ballots.id"],
            name=op.f("fk_ranked_results_ballot_id_ballots"),
            ondelete="RESTRICT",
        ),
    )
    op.execute("""CREATE FUNCTION reject_ranked_result_change() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Published ranked results are immutable'; END $$""")
    op.execute("""CREATE TRIGGER ranked_results_immutable BEFORE UPDATE OR DELETE ON ranked_results
        FOR EACH ROW EXECUTE FUNCTION reject_ranked_result_change()""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM ballots WHERE counting_method <> 'standard')
            OR EXISTS (SELECT 1 FROM vote_rankings) OR EXISTS (SELECT 1 FROM ranked_results) THEN
            RAISE EXCEPTION 'Cannot downgrade while ranked election data exists';
        END IF;
    END $$""")
    op.drop_table("ranked_results")
    op.execute("DROP FUNCTION reject_ranked_result_change()")
    op.drop_table("vote_rankings")
    op.drop_constraint("fk_vote_choices_method", "vote_choices", type_="foreignkey")
    op.drop_constraint(op.f("ck_vote_choices_storage_method"), "vote_choices", type_="check")
    op.drop_column("vote_choices", "storage_method")
    op.drop_constraint(op.f("ck_ballots_counting_method"), "ballots", type_="check")
    op.drop_constraint("uq_ballots_id_counting_method", "ballots", type_="unique")
    op.drop_column("ballots", "counting_method")
