"""add explicit season lifecycle and document ownership

Revision ID: add_season_lifecycle
Revises: repair_support_diagnostics
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op


revision: str = "add_season_lifecycle"
down_revision: Union[str, Sequence[str], None] = "repair_support_diagnostics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS seasons (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            slug VARCHAR(120) NOT NULL UNIQUE,
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            start_at TIMESTAMPTZ NOT NULL,
            submissions_open_at TIMESTAMPTZ NOT NULL,
            submissions_close_at TIMESTAMPTZ,
            moderation_close_at TIMESTAMPTZ,
            results_published_at TIMESTAMPTZ,
            finalized_at TIMESTAMPTZ,
            archived_at TIMESTAMPTZ,
            scoring_rules_version VARCHAR(50) NOT NULL DEFAULT 'v1',
            settings JSON,
            created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_seasons_status ON seasons (status)",
        "CREATE INDEX IF NOT EXISTS ix_seasons_start_at ON seasons (start_at)",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_seasons_one_live
        ON seasons ((1)) WHERE status IN ('active', 'moderation')
        """,
        """
        CREATE TABLE IF NOT EXISTS season_submission_exceptions (
            id SERIAL PRIMARY KEY,
            season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            reason TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT true,
            created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_season_exceptions_lookup ON season_submission_exceptions (season_id, user_id, expires_at)",
        """
        CREATE TABLE IF NOT EXISTS season_category_results (
            id SERIAL PRIMARY KEY,
            season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category VARCHAR(100) NOT NULL,
            points INTEGER NOT NULL DEFAULT 0,
            rank INTEGER NOT NULL DEFAULT 0,
            published_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_season_category_results_lookup ON season_category_results (season_id, category, rank)",
        "CREATE INDEX IF NOT EXISTS ix_season_category_results_user ON season_category_results (user_id)",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS season_id INTEGER",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS event_date DATE",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT now()",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS eligible_for_ranking BOOLEAN NOT NULL DEFAULT true",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS season_disposition VARCHAR(32) NOT NULL DEFAULT 'eligible'",
        "CREATE INDEX IF NOT EXISTS ix_achievements_season_id ON achievements (season_id)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_file_hash ON achievements (file_hash)",
        "ALTER TABLE season_results ADD COLUMN IF NOT EXISTS season_id INTEGER",
        "ALTER TABLE season_results ADD COLUMN IF NOT EXISTS achievements_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE season_results ADD COLUMN IF NOT EXISTS category_points JSON",
        "ALTER TABLE season_results ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS ix_season_results_season_id ON season_results (season_id)",
    ]
    for statement in statements:
        op.execute(statement)

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_achievements_season_id') THEN
                ALTER TABLE achievements ADD CONSTRAINT fk_achievements_season_id
                FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_season_results_season_id') THEN
                ALTER TABLE season_results ADD CONSTRAINT fk_season_results_season_id
                FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
            END IF;
        END $$
        """
    )

    # Preserve every legacy archive as a real immutable season.
    op.execute(
        """
        WITH legacy_names AS (
            SELECT archived_season AS name FROM achievements WHERE archived_season IS NOT NULL
            UNION
            SELECT season_name AS name FROM season_results WHERE season_name IS NOT NULL
        ), bounds AS (
            SELECT n.name,
                   COALESCE(MIN(a.created_at), MIN(sr.created_at), now()) AS starts,
                   COALESCE(MAX(a.updated_at), MAX(sr.created_at), now()) AS ends
            FROM legacy_names n
            LEFT JOIN achievements a ON a.archived_season = n.name
            LEFT JOIN season_results sr ON sr.season_name = n.name
            GROUP BY n.name
        )
        INSERT INTO seasons (name, slug, status, start_at, submissions_open_at,
                             submissions_close_at, moderation_close_at,
                             results_published_at, finalized_at, archived_at)
        SELECT name, 'legacy-' || md5(name), 'archived', starts, starts,
               ends, ends, ends, ends, ends
        FROM bounds
        ON CONFLICT (name) DO NOTHING
        """
    )

    # A live season is created only when production does not already have one.
    op.execute(
        """
        INSERT INTO seasons (name, slug, status, start_at, submissions_open_at)
        SELECT 'Текущий сезон', 'current-season', 'active',
               COALESCE((SELECT MIN(created_at) FROM achievements WHERE archived_season IS NULL), now()),
               COALESCE((SELECT MIN(created_at) FROM achievements WHERE archived_season IS NULL), now())
        WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE status IN ('active', 'moderation'))
        ON CONFLICT (name) DO NOTHING
        """
    )

    op.execute(
        """
        UPDATE achievements a
        SET season_id = s.id
        FROM seasons s
        WHERE a.season_id IS NULL AND a.archived_season = s.name
        """
    )
    op.execute(
        """
        UPDATE achievements
        SET season_id = (SELECT id FROM seasons WHERE status IN ('active', 'moderation') ORDER BY id DESC LIMIT 1)
        WHERE season_id IS NULL AND archived_season IS NULL
        """
    )
    op.execute("UPDATE achievements SET event_date = created_at::date WHERE event_date IS NULL")
    op.execute("UPDATE achievements SET submitted_at = created_at WHERE submitted_at IS NULL")
    op.execute(
        """
        UPDATE achievements
        SET eligible_for_ranking = false,
            season_disposition = 'not_counted'
        WHERE archived_season IS NOT NULL
          AND COALESCE(archived_from_status, status::text) NOT IN ('approved', 'APPROVED')
        """
    )
    op.execute(
        """
        UPDATE season_results sr
        SET season_id = s.id,
            published_at = COALESCE(sr.published_at, sr.created_at)
        FROM seasons s
        WHERE sr.season_id IS NULL AND sr.season_name = s.name
        """
    )


def downgrade() -> None:
    # Season migration is intentionally non-destructive: production archives and
    # audit-relevant ownership must remain available after application rollback.
    pass
