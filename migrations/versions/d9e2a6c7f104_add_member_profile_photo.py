"""Add member-managed profile photos.

Revision ID: d9e2a6c7f104
Revises: b9c1d4e6f8a0
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa


revision = "d9e2a6c7f104"
down_revision = "b9c1d4e6f8a0"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("members")}
    if "profile_photo_path" not in columns:
        op.add_column("members", sa.Column("profile_photo_path", sa.String(length=2048), nullable=True))


def downgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("members")}
    if "profile_photo_path" in columns:
        op.drop_column("members", "profile_photo_path")
