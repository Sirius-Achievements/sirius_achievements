"""repair legacy support and bug-report columns

Revision ID: repair_support_diagnostics
Revises: repair_visibility_archive
Create Date: 2026-08-23
"""

from typing import Sequence, Union

from alembic import op


revision: str = "repair_support_diagnostics"
down_revision: Union[str, Sequence[str], None] = "repair_visibility_archive"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Production once carried an Alembic head stamp newer than its physical
    # schema.  Keep this repair fully idempotent so it is safe for both the
    # affected database and fresh installations.
    statements = [
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'technical'",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution VARCHAR(50)",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS student_unread_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS moderator_unread_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES support_messages(id) ON DELETE SET NULL",
        "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS console_summary TEXT",
        "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS network_summary TEXT",
        "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(255)",
        "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'open'",
        "ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS session_elapsed_ms INTEGER",
        "CREATE INDEX IF NOT EXISTS ix_bug_reports_fingerprint ON bug_reports (fingerprint)",
        "CREATE INDEX IF NOT EXISTS ix_bug_reports_status ON bug_reports (status)",
    ]
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    # This migration repairs production data structures.  A rollback must not
    # remove fields that may already contain messages or diagnostics.
    pass
