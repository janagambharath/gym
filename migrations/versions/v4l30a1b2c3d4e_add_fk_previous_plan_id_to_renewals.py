"""Add FK on renewal_history.previous_plan_id (V4-L30).

V3-M18's migration (v3m18a1b2c3d4) added the ``previous_plan_id`` column
with no foreign key, while the model (app/models/renewal_history.py)
declares ``ForeignKey("membership_plans.id", ondelete="SET NULL")`` —
so the DB constraint and the model disagreed. This migration adds the
FK at the DB level to match the model. A NEW migration (not an edit of
v3m18a1b2c3d4's upgrade(), which is already live in Batch 1).

NOTE: if any stored previous_plan_id points at a plan that no longer
exists, this migration fails at CREATE CONSTRAINT — that is a data
cleanup job first, not something to silently resolve here.

Revises: m3rg3v3fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "v4l30a1b2c3d4e"
down_revision = "m3rg3v3fixall"

CONSTRAINT = "fk_renewal_history_previous_plan_id"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = {c["name"] for c in inspector.get_columns("renewal_history")}
    if "previous_plan_id" not in columns:
        # v3m18a1b2c3d4 never ran on this DB; nothing to constrain.
        print("[v4-l30] previous_plan_id column absent, skipping FK")
        return
    existing_fks = [
        fk
        for fk in inspector.get_foreign_keys("renewal_history")
        if "previous_plan_id" in fk.get("constrained_columns", [])
        and fk.get("referred_table") == "membership_plans"
    ]
    if existing_fks:
        print("[v4-l30] FK on previous_plan_id already exists, skipping")
        return
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.create_foreign_key(
            CONSTRAINT,
            "membership_plans",
            ["previous_plan_id"],
            ["id"],
            ondelete="SET NULL",
        )
    print(f"[v4-l30] created {CONSTRAINT}")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {
        fk["name"]
        for fk in inspector.get_foreign_keys("renewal_history")
        if fk.get("name")
    }
    if CONSTRAINT not in existing:
        print(f"[v4-l30] {CONSTRAINT} absent, nothing to drop")
        return
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.drop_constraint(CONSTRAINT, type_="foreignkey")
    print(f"[v4-l30] dropped {CONSTRAINT}")
