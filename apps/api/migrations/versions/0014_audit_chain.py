"""linking audit records with hashes, without proving older records were unchanged before this"""

from datetime import UTC
from hashlib import sha256
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0014_audit_chain"
down_revision = "0013_ranked_elections"
branch_labels = None
depends_on = None


# keeping format v1 here so later app changes won't affect this migration
def timestamp(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def digest(domain, fields):
    encoded = bytearray(domain + b"\x00")
    for field in fields:
        if field is None:
            encoded.extend(b"\x00")
        else:
            data = field.encode("utf-8")
            encoded.extend(b"\x01" + len(data).to_bytes(4, "big") + data)
    return sha256(encoded).hexdigest()


def upgrade():
    connection = op.get_bind()
    
    # blocking new records while adding sequence numbers and hashes to existing ones
    op.execute("LOCK TABLE audit_events IN ACCESS EXCLUSIVE MODE")
    op.create_table(
        "audit_chain",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("chain_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("legacy_count", sa.BigInteger(), nullable=False),
        sa.Column("genesis_digest", sa.String(64), nullable=False),
        sa.Column("head_sequence", sa.BigInteger(), nullable=False),
        sa.Column("head_digest", sa.String(64), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_chain")),
        sa.UniqueConstraint("chain_id", name=op.f("uq_audit_chain_chain_id")),
        sa.CheckConstraint("id = 1", name=op.f("ck_audit_chain_singleton")),
        sa.CheckConstraint(
            "legacy_count >= 0 AND head_sequence >= legacy_count",
            name=op.f("ck_audit_chain_counts"),
        ),
        sa.CheckConstraint(
            "genesis_digest ~ '^[0-9a-f]{64}$' AND head_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_audit_chain_digests"),
        ),
    )
    for name, type_ in [
        ("chain_id", sa.Uuid()),
        ("sequence", sa.BigInteger()),
        ("previous_digest", sa.String(64)),
        ("event_digest", sa.String(64)),
    ]:
        op.add_column("audit_events", sa.Column(name, type_, nullable=True))
    op.add_column(
        "audit_events",
        sa.Column("encoding_version", sa.Integer(), server_default="1", nullable=False),
    )
    chain_id = uuid4()
    started = connection.scalar(sa.text("SELECT clock_timestamp()"))
    count = connection.scalar(sa.text("SELECT count(*) FROM audit_events"))
    genesis = digest(b"voting-audit-genesis-v1", [str(chain_id), timestamp(started), str(count)])
    connection.execute(
        sa.text("""INSERT INTO audit_chain
        (id, chain_id, started_at, legacy_count, genesis_digest, head_sequence, head_digest)
        VALUES (1, :chain, :started, :count, :genesis, :count, :genesis)"""),
        dict(chain=chain_id, started=started, count=count, genesis=genesis),
    )
    previous = genesis

    # processing records in small batches, keeping their original details unchanged
    last_time, last_id = None, None
    sequence = 0
    while True:
        predicate = "WHERE (occurred_at, id) > (:time, :id)" if last_id else ""
        rows = (
            connection.execute(
                sa.text(
                    "SELECT id, occurred_at, action, actor_id, target_id, meeting_id "
                    "FROM audit_events " + predicate + " ORDER BY occurred_at, id LIMIT 500"
                ),
                dict(time=last_time, id=last_id),
            )
            .mappings()
            .all()
        )
        if not rows:
            break
        for row in rows:
            sequence += 1
            hashed = digest(
                b"voting-audit-event-v1",
                [
                    str(chain_id),
                    str(sequence),
                    previous,
                    str(row["id"]),
                    timestamp(row["occurred_at"]),
                    row["action"],
                    str(row["actor_id"]) if row["actor_id"] else None,
                    str(row["target_id"]),
                    str(row["meeting_id"]) if row["meeting_id"] else None,
                ],
            )
            connection.execute(
                sa.text("""UPDATE audit_events SET chain_id=:chain, sequence=:seq,
                previous_digest=:previous, event_digest=:digest WHERE id=:id"""),
                dict(chain=chain_id, seq=sequence, previous=previous, digest=hashed, id=row["id"]),
            )
            previous = hashed
        last_time, last_id = rows[-1]["occurred_at"], rows[-1]["id"]
    connection.execute(
        sa.text("UPDATE audit_chain SET head_digest=:digest WHERE id=1"), dict(digest=previous)
    )
    for name in ["chain_id", "sequence", "previous_digest", "event_digest"]:
        op.alter_column("audit_events", name, nullable=False)
    op.create_foreign_key(
        op.f("fk_audit_events_chain_id_audit_chain"),
        "audit_events",
        "audit_chain",
        ["chain_id"],
        ["chain_id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(op.f("uq_audit_events_sequence"), "audit_events", ["sequence"])
    op.create_check_constraint(
        op.f("ck_audit_events_sequence_positive"), "audit_events", "sequence >= 1"
    )
    op.create_check_constraint(
        op.f("ck_audit_events_encoding_version"), "audit_events", "encoding_version = 1"
    )

    op.create_check_constraint(
        op.f("ck_audit_events_digests"),
        "audit_events",
        "previous_digest ~ '^[0-9a-f]{64}$' AND event_digest ~ '^[0-9a-f]{64}$'",
    )
    op.execute("""CREATE FUNCTION reject_audit_history_change() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history cannot be changed'; END $$""")
    
    op.execute("""CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_audit_history_change()""")
    op.execute("""CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
        FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_history_change()""")
    op.execute("""CREATE TRIGGER audit_chain_no_delete BEFORE DELETE ON audit_chain
        FOR EACH ROW EXECUTE FUNCTION reject_audit_history_change()""")
    op.execute("""CREATE TRIGGER audit_chain_no_truncate BEFORE TRUNCATE ON audit_chain
        FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_history_change()""")
    op.execute("""CREATE FUNCTION preserve_audit_genesis() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF (NEW.id, NEW.chain_id, NEW.started_at, NEW.legacy_count, NEW.genesis_digest)
            IS DISTINCT FROM
            (OLD.id, OLD.chain_id, OLD.started_at, OLD.legacy_count, OLD.genesis_digest)
            THEN RAISE EXCEPTION 'Audit genesis cannot be changed'; END IF; RETURN NEW; END $$""")
    op.execute("""CREATE TRIGGER audit_chain_genesis_immutable BEFORE UPDATE ON audit_chain
        FOR EACH ROW EXECUTE FUNCTION preserve_audit_genesis()""")


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM audit_events)
        OR EXISTS (SELECT 1 FROM audit_chain WHERE head_sequence <> 0) THEN
        RAISE EXCEPTION 'Cannot downgrade while audit chain history exists'; END IF; END $$""")
    op.execute("DROP TRIGGER audit_events_immutable ON audit_events")
    op.execute("DROP TRIGGER audit_events_no_truncate ON audit_events")
    op.drop_constraint(
        op.f("fk_audit_events_chain_id_audit_chain"), "audit_events", type_="foreignkey"
    )

    op.drop_constraint(op.f("uq_audit_events_sequence"), "audit_events", type_="unique")
    for name in ["sequence_positive", "encoding_version", "digests"]:
        op.drop_constraint(op.f("ck_audit_events_" + name), "audit_events", type_="check")

    for name in ["chain_id", "sequence", "encoding_version", "previous_digest", "event_digest"]:
        op.drop_column("audit_events", name)

    op.drop_table("audit_chain")
    op.execute("DROP FUNCTION reject_audit_history_change()")
    op.execute("DROP FUNCTION preserve_audit_genesis()")
