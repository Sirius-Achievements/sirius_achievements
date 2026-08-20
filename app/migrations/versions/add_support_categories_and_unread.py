"""add support categories, reply and unread counters

Revision ID: add_support_chat_features
Revises: add_profile_visibility
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'add_support_chat_features'
down_revision: Union[str, Sequence[str], None] = 'add_profile_visibility'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('support_tickets', sa.Column('category', sa.String(50), nullable=False, server_default='technical'))
    op.add_column('support_tickets', sa.Column('resolution', sa.String(50), nullable=True))
    op.add_column('support_tickets', sa.Column('student_unread_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('support_tickets', sa.Column('moderator_unread_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('support_messages', sa.Column('reply_to_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_support_messages_reply_to', 'support_messages', 'support_messages', ['reply_to_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_support_messages_reply_to', 'support_messages', type_='foreignkey')
    op.drop_column('support_messages', 'reply_to_id')
    op.drop_column('support_tickets', 'moderator_unread_count')
    op.drop_column('support_tickets', 'student_unread_count')
    op.drop_column('support_tickets', 'resolution')
    op.drop_column('support_tickets', 'category')
