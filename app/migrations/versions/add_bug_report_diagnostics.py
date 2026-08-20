"""Add diagnostic summaries and lifecycle to bug reports.

Revision ID: add_bug_report_diagnostics
Revises: add_support_chat_features
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_bug_report_diagnostics'
down_revision: Union[str, Sequence[str], None] = 'add_support_chat_features'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('bug_reports', sa.Column('console_summary', sa.Text(), nullable=True))
    op.add_column('bug_reports', sa.Column('network_summary', sa.Text(), nullable=True))
    op.add_column('bug_reports', sa.Column('fingerprint', sa.String(length=255), nullable=True))
    op.add_column('bug_reports', sa.Column('status', sa.String(length=32), nullable=False, server_default='open'))
    op.add_column('bug_reports', sa.Column('session_elapsed_ms', sa.Integer(), nullable=True))
    op.create_index('ix_bug_reports_fingerprint', 'bug_reports', ['fingerprint'])
    op.create_index('ix_bug_reports_status', 'bug_reports', ['status'])


def downgrade() -> None:
    op.drop_index('ix_bug_reports_status', table_name='bug_reports')
    op.drop_index('ix_bug_reports_fingerprint', table_name='bug_reports')
    op.drop_column('bug_reports', 'session_elapsed_ms')
    op.drop_column('bug_reports', 'status')
    op.drop_column('bug_reports', 'fingerprint')
    op.drop_column('bug_reports', 'network_summary')
    op.drop_column('bug_reports', 'console_summary')
