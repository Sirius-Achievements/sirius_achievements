"""add user_notes table and missing users columns (study_group, session_gpa)

Revision ID: add_user_notes_and_user_extras
Revises: add_moderator_scope
Create Date: 2026-07-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "add_user_notes_and_user_extras"
down_revision: Union[str, Sequence[str], None] = "add_moderator_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS study_group VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_gpa VARCHAR")

    # Model treats file_path as nullable (external_url may replace it) — align schema.
    op.execute("ALTER TABLE achievements ALTER COLUMN file_path DROP NOT NULL")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_notes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            text TEXT NOT NULL,
            file_path VARCHAR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_notes_user_id ON user_notes (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_notes")
    op.execute("ALTER TABLE achievements ALTER COLUMN file_path SET NOT NULL")
    op.drop_column("users", "session_gpa")
    op.drop_column("users", "study_group")
