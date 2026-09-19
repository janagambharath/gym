"""merge multiple heads

Revision ID: 4d750d2fb69b
Revises: 8f6d4f8844fb, i1a2b3c4d5e8
Create Date: 2026-09-19 12:49:26.043672

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4d750d2fb69b'
down_revision = ('8f6d4f8844fb', 'i1a2b3c4d5e8')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
