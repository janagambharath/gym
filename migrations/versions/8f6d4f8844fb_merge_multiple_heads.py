"""merge_multiple_heads

Revision ID: 8f6d4f8844fb
Revises: a001_access_events, a3b4c5d6e7f8, h1a2b3c4d5e7
Create Date: 2026-09-12 15:01:11.529878

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8f6d4f8844fb'
down_revision = ('a001_access_events', 'a3b4c5d6e7f8', 'h1a2b3c4d5e7')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
