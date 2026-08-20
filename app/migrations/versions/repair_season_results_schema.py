"""repair season results schema

Revision ID: repair_season_results
Revises: add_registration_reject
Create Date: 2026-08-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'repair_season_results'
down_revision: Union[str, Sequence[str], None] = 'add_registration_reject'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'season_results' not in tables:
        op.create_table(
            'season_results',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('season_name', sa.String(length=100), nullable=False),
            sa.Column('points', sa.Integer(), nullable=True),
            sa.Column('rank', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_season_results_id', 'season_results', ['id'], unique=False)
        op.create_index('ix_season_results_user_id', 'season_results', ['user_id'], unique=False)
        return

    columns = {column['name'] for column in inspector.get_columns('season_results')}
    if 'created_at' not in columns:
        op.add_column(
            'season_results',
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        )

    indexes = {index['name'] for index in inspector.get_indexes('season_results')}
    if 'ix_season_results_user_id' not in indexes:
        op.create_index('ix_season_results_user_id', 'season_results', ['user_id'], unique=False)


def downgrade() -> None:
    # Schema repair is intentionally not destructive.
    pass
