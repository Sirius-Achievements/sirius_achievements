"""Store registration rejection reason.

Revision ID: add_registration_reject
Revises: add_bug_report_diagnostics
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_registration_reject'
down_revision: Union[str, Sequence[str], None] = 'add_bug_report_diagnostics'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('registration_rejection_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'registration_rejection_reason')
