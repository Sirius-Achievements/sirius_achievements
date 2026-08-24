from sqlalchemy.dialects import postgresql

from app.models.enums import AchievementStatus
from app.routers.api.v1.dashboard import (
    _achievement_effective_status,
    _achievement_season_condition,
)
from app.routers.api.v1.leaderboard import _approved_achievement_condition


def _sql(expression) -> str:
    return str(
        expression.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    ).lower()


def test_current_season_excludes_archived_documents():
    sql = _sql(_achievement_season_condition("current"))

    assert "status != 'archived'" in sql


def test_closed_season_is_linked_by_stable_season_name():
    sql = _sql(_achievement_effective_status("Осень 2026", AchievementStatus.APPROVED))

    assert "status = 'archived'" in sql
    assert "archived_season = 'Осень 2026'".lower() in sql
    assert "archived_from_status = 'approved'" in sql


def test_global_leaderboard_combines_current_and_archived_approved_documents():
    sql = _sql(_approved_achievement_condition("global"))

    assert "status = 'approved'" in sql
    assert "status = 'archived'" in sql
    assert "archived_from_status = 'approved'" in sql
