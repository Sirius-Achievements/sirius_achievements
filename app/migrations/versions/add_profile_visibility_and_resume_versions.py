"""add profile visibility and resume version history

Revision ID: add_profile_visibility
Revises: add_bug_reports
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'add_profile_visibility'
down_revision: Union[str, Sequence[str], None] = 'add_bug_reports'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column['name'] for column in inspector.get_columns('users')}
    if 'public_visibility' not in user_columns:
        op.add_column('users', sa.Column('public_visibility', sa.JSON(), nullable=True))

    if 'resume_versions' not in inspector.get_table_names():
        op.create_table(
            'resume_versions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('source_documents_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_resume_versions_user_id', 'resume_versions', ['user_id'])
    else:
        index_names = {index['name'] for index in inspector.get_indexes('resume_versions')}
        if 'ix_resume_versions_user_id' not in index_names:
            op.create_index('ix_resume_versions_user_id', 'resume_versions', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_resume_versions_user_id', table_name='resume_versions')
    op.drop_table('resume_versions')
    op.drop_column('users', 'public_visibility')
