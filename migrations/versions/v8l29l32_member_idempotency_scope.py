"""Add member_id scoping to mobile idempotency keys (V8-L29/L32).

Member-API endpoints (verify-otp, self-delete, renew/claim) derive identity
from the member Bearer <redacted> token, and members are not ``User`` rows — so a
member retry cannot be stored under ``user_id``: the FK to ``users.id``
would fail on Postgres, and stuffing the member id in would silently
collide with a real user of the same id. This migration:

- adds ``mobile_idempotency_keys.member_id`` (nullable FK to
  ``members.id``, ON DELETE CASCADE) — set on member-API rows, NULL on
  owner/staff rows;
- relaxes ``user_id`` to nullable (NULL on member-API rows);
- adds unique constraint ``uq_mobile_idempotency_member_scope_key`` on
  (gym_id, member_id, scope, key) so a member retry races the same way
  an owner retry does. The existing ``uq_mobile_idempotency_scope_key``
  stays and still covers owner rows; Postgres/SQLite both treat NULLs
  as distinct in a unique constraint, so neither constraint can fire
  on the wrong row type.

No data is rewritten: every existing row has member_id NULL (owner
rows) and keeps its user_id. Downgrade deletes member-scoped replay
rows first (24h TTL anyway, so nothing durable is lost), then drops
the constraint + column and restores user_id NOT NULL.

Revises: v8l4usertokenver
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v8l29l32memberidem"
down_revision = "v8l4usertokenver"
branch_labels = None
depends_on = None

TABLE = "mobile_idempotency_keys"
COLUMN = "member_id"
CONSTRAINT = "uq_mobile_idempotency_member_scope_key"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(f"[v8-l29/l32] table {TABLE} absent — nothing to do.")
        return
    columns = {c["name"]: c for c in inspector.get_columns(TABLE)}
    with op.batch_alter_table(TABLE) as batch_op:
        if COLUMN not in columns:
            batch_op.add_column(
                sa.Column(
                    COLUMN,
                    sa.Integer(),
                    # Named FK: batch mode on SQLite recreates the table
                    # and ApplyBatchImpl refuses unnamed constraints, so
                    # an anonymous inline ForeignKey fails the upgrade
                    # there (Postgres ALTERs in place and never notices).
                    sa.ForeignKey(
                        "members.id",
                        name="fk_mobile_idempotency_member_id",
                        ondelete="CASCADE",
                    ),
                    nullable=True,
                )
            )
            print(f"[v8-l29/l32] added {TABLE}.{COLUMN} (nullable FK to members.id).")
        else:
            print(f"[v8-l29/l32] column {COLUMN} already present — no-op.")
        if columns.get("user_id") is not None and not columns["user_id"]["nullable"]:
            batch_op.alter_column("user_id", nullable=True)
            print(f"[v8-l29/l32] relaxed {TABLE}.user_id to nullable.")
        existing_constraints = {
            c["name"] for c in inspector.get_unique_constraints(TABLE)
        }
        if CONSTRAINT not in existing_constraints:
            batch_op.create_unique_constraint(
                CONSTRAINT, ["gym_id", "member_id", "scope", "key"]
            )
            print(f"[v8-l29/l32] added unique constraint {CONSTRAINT}.")
        else:
            print(f"[v8-l29/l32] constraint {CONSTRAINT} already present — no-op.")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    columns = {c["name"]: c for c in inspector.get_columns(TABLE)}
    # Member-scoped rows carry user_id NULL; deleting them first makes
    # restoring the NOT NULL constraint safe.
    if COLUMN in columns:
        conn.execute(
            sa.text(f"DELETE FROM {TABLE} WHERE user_id IS NULL")
        )
    with op.batch_alter_table(TABLE) as batch_op:
        existing_constraints = {
            c["name"] for c in inspector.get_unique_constraints(TABLE)
        }
        if CONSTRAINT in existing_constraints:
            batch_op.drop_constraint(CONSTRAINT, type_="unique")
        if COLUMN in columns:
            batch_op.drop_column(COLUMN)
        if columns.get("user_id") is not None and columns["user_id"]["nullable"]:
            batch_op.alter_column("user_id", nullable=False)
    print(f"[v8-l29/l32] dropped {TABLE}.{COLUMN} + {CONSTRAINT}; user_id NOT NULL again.")
