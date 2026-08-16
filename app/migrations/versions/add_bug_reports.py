"""add bug reports

Revision ID: add_bug_reports
Revises: add_user_notes_and_user_extras
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'add_bug_reports'
down_revision: Union[str, Sequence[str], None] = 'add_user_notes_and_user_extras'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS bug_reports (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            description TEXT,
            page_url VARCHAR(2048) NOT NULL,
            session_id VARCHAR(255),
            app_version VARCHAR(100),
            user_agent VARCHAR(1000),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS ix_bug_reports_user_id ON bug_reports (user_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_bug_reports_session_id ON bug_reports (session_id)')


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS bug_reports')
