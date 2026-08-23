"""repair profile privacy columns and add exact season archive marker

Revision ID: repair_visibility_archive
Revises: repair_season_results
Create Date: 2026-08-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'repair_visibility_archive'
down_revision: Union[str, Sequence[str], None] = 'repair_season_results'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    user_columns = {column['name'] for column in inspector.get_columns('users')}
    if 'public_visibility' not in user_columns:
        op.add_column('users', sa.Column('public_visibility', sa.JSON(), nullable=True))
    if 'registration_rejection_reason' not in user_columns:
        op.add_column('users', sa.Column('registration_rejection_reason', sa.Text(), nullable=True))

    achievement_columns = {column['name'] for column in inspector.get_columns('achievements')}
    if 'archived_season' not in achievement_columns:
        op.add_column('achievements', sa.Column('archived_season', sa.String(length=100), nullable=True))
    if 'archived_from_status' not in achievement_columns:
        op.add_column('achievements', sa.Column('archived_from_status', sa.String(length=20), nullable=True))

    inspector = sa.inspect(bind)
    achievement_indexes = {index['name'] for index in inspector.get_indexes('achievements')}
    if 'ix_achievements_archived_season' not in achievement_indexes:
        op.create_index('ix_achievements_archived_season', 'achievements', ['archived_season'], unique=False)


def downgrade() -> None:
    # This is a production schema repair.  Do not remove user data on rollback.
    pass
