from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.achievement import Achievement
from app.models.enums import AchievementStatus
from app.models.season import Season, SeasonSubmissionException


LIVE_SEASON_STATUSES = ("active", "moderation")
FINAL_SEASON_STATUSES = ("published", "archived")


@dataclass(slots=True)
class SeasonRuleError(Exception):
    message: str
    status_code: int = 409

    def __str__(self) -> str:
        return self.message


def utc_aware(value: datetime | None) -> datetime | None:
    """Normalize timestamps returned by test SQLite and production Postgres."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def get_live_season(db: AsyncSession, *, lock: bool = False) -> Season | None:
    stmt = (
        select(Season)
        .where(Season.status.in_(LIVE_SEASON_STATUSES))
        .order_by(Season.start_at.desc(), Season.id.desc())
        .limit(1)
    )
    if lock:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalars().first()


async def get_active_submission_season(
    db: AsyncSession,
    *,
    user_id: int,
    event_date: date,
    now: datetime | None = None,
) -> Season:
    now = now or datetime.now(timezone.utc)
    season = await get_live_season(db)
    if not season:
        raise SeasonRuleError("Приём документов сейчас закрыт: активного сезона нет.")
    submissions_open_at = utc_aware(season.submissions_open_at)
    submissions_close_at = utc_aware(season.submissions_close_at)
    if submissions_open_at and now < submissions_open_at:
        raise SeasonRuleError("Приём документов этого сезона ещё не начался.")

    extension = None
    if season.status == "moderation" or (submissions_close_at and now > submissions_close_at):
        extension = await db.scalar(
            select(SeasonSubmissionException.id)
            .where(
                SeasonSubmissionException.season_id == season.id,
                SeasonSubmissionException.user_id == user_id,
                SeasonSubmissionException.active.is_(True),
                SeasonSubmissionException.expires_at >= now,
            )
            .limit(1)
        )
    if season.status not in LIVE_SEASON_STATUSES or (
        season.status == "moderation" and not extension
    ) or (submissions_close_at and now > submissions_close_at and not extension):
        raise SeasonRuleError("Приём документов завершён. При необходимости запросите индивидуальное продление.")

    eligibility_end = min((submissions_close_at or now).date(), now.date())
    if event_date < season.start_at.date() or event_date > eligibility_end:
        raise SeasonRuleError(
            f"Дата достижения не относится к сезону «{season.name}» "
            f"({season.start_at.date().strftime('%d.%m.%Y')}–{eligibility_end.strftime('%d.%m.%Y')}).",
            422,
        )
    return season


def ensure_revision_allowed(season: Season | None, *, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if not season or season.status not in LIVE_SEASON_STATUSES:
        raise SeasonRuleError("Сезон документа завершён. Доработка больше не принимается.")
    moderation_close_at = utc_aware(season.moderation_close_at)
    if moderation_close_at and now > moderation_close_at:
        raise SeasonRuleError("Срок доработки документа в этом сезоне истёк.")


def ensure_moderation_allowed(season: Season | None, *, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if not season or season.status not in LIVE_SEASON_STATUSES:
        raise SeasonRuleError("Сезон документа уже опубликован. Решение изменять нельзя.")
    moderation_close_at = utc_aware(season.moderation_close_at)
    if moderation_close_at and now > moderation_close_at:
        raise SeasonRuleError("Срок модерации сезона истёк. Сначала опубликуйте результаты сезона.")


def effective_approved_condition():
    return or_(
        and_(Achievement.status == AchievementStatus.APPROVED, Achievement.eligible_for_ranking.is_(True)),
        and_(
            Achievement.status == AchievementStatus.ARCHIVED,
            Achievement.archived_from_status == AchievementStatus.APPROVED.value,
            Achievement.eligible_for_ranking.is_(True),
        ),
    )


def season_document_condition(season: Season):
    return Achievement.season_id == season.id
