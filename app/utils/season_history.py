from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True, slots=True)
class SeasonHistoryItem:
    id: int
    user_id: int
    season_name: str
    points: int
    rank: int
    created_at: datetime | None = None


async def load_season_history(db: AsyncSession, user_id: int) -> list[SeasonHistoryItem]:
    """Read season results without assuming every deployment has the newest columns."""
    table_name = await db.scalar(text("SELECT to_regclass('public.season_results')"))
    if table_name is None:
        return []

    columns = set(
        (
            await db.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'season_results'
                    """
                )
            )
        ).scalars().all()
    )
    required_columns = {'id', 'user_id', 'season_name', 'points', 'rank'}
    if not required_columns.issubset(columns):
        return []

    created_at_expr = 'created_at' if 'created_at' in columns else 'NULL::timestamptz AS created_at'
    order_expr = 'created_at DESC NULLS LAST, id DESC' if 'created_at' in columns else 'id DESC'
    rows = (
        await db.execute(
            text(
                f"""
                SELECT id, user_id, season_name, points, rank, {created_at_expr}
                FROM season_results
                WHERE user_id = :user_id
                ORDER BY {order_expr}
                """
            ),
            {'user_id': user_id},
        )
    ).mappings().all()

    return [
        SeasonHistoryItem(
            id=int(row['id']),
            user_id=int(row['user_id']),
            season_name=str(row['season_name']),
            points=int(row['points'] or 0),
            rank=int(row['rank'] or 0),
            created_at=row['created_at'],
        )
        for row in rows
    ]
