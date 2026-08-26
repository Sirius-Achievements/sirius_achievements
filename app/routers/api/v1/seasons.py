from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, desc, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.config import settings
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.bug_report import BugReport
from app.models.enums import AchievementStatus, UserRole, UserStatus
from app.models.season import Season, SeasonCategoryResult, SeasonSubmissionException
from app.models.season_result import SeasonResult
from app.models.user import Users
from app.services.audit_service import log_action
from app.services.season_service import effective_approved_condition, get_live_season, utc_aware
from app.utils.points import aggregated_gpa_bonus_expr
from app.utils.cache import invalidate_scoreboard_caches
from app.utils import storage
from app.utils.rate_limiter import get_redis


router = APIRouter(prefix="/api/v1/seasons", tags=["api.v1.seasons"])
EPOCH_HEALTH_URL = os.getenv("EPOCH_HEALTH_URL", "https://epoch.ixyo.ru/console")


class SeasonCreatePayload(BaseModel):
    name: str = Field(min_length=3, max_length=100)
    start_at: datetime
    submissions_open_at: datetime
    submissions_close_at: datetime
    moderation_close_at: datetime
    scoring_rules_version: str = Field(default="v1", min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_dates(self):
        if not (self.start_at <= self.submissions_open_at < self.submissions_close_at < self.moderation_close_at):
            raise ValueError("Даты должны идти по порядку: начало → приём → закрытие → окончание модерации.")
        return self


class SeasonUpdatePayload(SeasonCreatePayload):
    pass


class SeasonExceptionPayload(BaseModel):
    user_id: int
    expires_at: datetime
    reason: str = Field(min_length=5, max_length=1000)


def _serialize_season(season: Season, counts: dict | None = None) -> dict:
    payload = {
        "id": season.id,
        "name": season.name,
        "slug": season.slug,
        "status": season.status,
        "start_at": season.start_at.isoformat(),
        "submissions_open_at": season.submissions_open_at.isoformat(),
        "submissions_close_at": season.submissions_close_at.isoformat() if season.submissions_close_at else None,
        "moderation_close_at": season.moderation_close_at.isoformat() if season.moderation_close_at else None,
        "results_published_at": season.results_published_at.isoformat() if season.results_published_at else None,
        "finalized_at": season.finalized_at.isoformat() if season.finalized_at else None,
        "archived_at": season.archived_at.isoformat() if season.archived_at else None,
        "scoring_rules_version": season.scoring_rules_version,
    }
    if counts is not None:
        payload.update(counts)
    return payload


def _require_staff(user) -> None:
    if user.role not in {UserRole.MODERATOR, UserRole.SUPER_ADMIN}:
        raise HTTPException(status_code=403, detail="Раздел доступен только сотрудникам.")


def _require_super_admin(user) -> None:
    if user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Управлять сезонами может только супер-администратор.")


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9а-яё]+", "-", value.lower(), flags=re.IGNORECASE).strip("-")
    return slug or f"season-{int(datetime.now(timezone.utc).timestamp())}"


@router.get("")
@router.get("/")
async def list_seasons(current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_staff(current_user)
    count_rows = (await db.execute(
        select(
            Achievement.season_id,
            func.count(Achievement.id).label("documents"),
            func.count(func.distinct(Achievement.user_id)).label("participants"),
            func.count(Achievement.id).filter(effective_approved_condition()).label("approved"),
            func.count(Achievement.id).filter(Achievement.status == AchievementStatus.PENDING).label("pending"),
        ).group_by(Achievement.season_id)
    )).all()
    counts_by_id = {
        row.season_id: {
            "documents": int(row.documents or 0),
            "participants": int(row.participants or 0),
            "approved": int(row.approved or 0),
            "pending": int(row.pending or 0),
        }
        for row in count_rows
    }
    seasons = (await db.execute(select(Season).order_by(desc(Season.start_at), desc(Season.id)))).scalars().all()
    live = next((item for item in seasons if item.status in {"active", "moderation"}), None)
    return {
        "live_season_id": live.id if live else None,
        "seasons": [
            _serialize_season(
                item,
                counts_by_id.get(item.id, {"documents": 0, "participants": 0, "approved": 0, "pending": 0}),
            )
            for item in seasons
        ],
    }


@router.get("/current")
async def current_season(current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    """Small season contract used by the student upload flow."""
    season = await get_live_season(db)
    if not season:
        return {"season": None, "can_submit": False, "message": "Активного сезона сейчас нет."}
    now = datetime.now(timezone.utc)
    opens = utc_aware(season.submissions_open_at)
    closes = utc_aware(season.submissions_close_at)
    extension = None
    if current_user.role == UserRole.STUDENT:
        extension = (await db.execute(
            select(SeasonSubmissionException)
            .where(
                SeasonSubmissionException.season_id == season.id,
                SeasonSubmissionException.user_id == current_user.id,
                SeasonSubmissionException.active.is_(True),
                SeasonSubmissionException.expires_at >= now,
            )
            .order_by(SeasonSubmissionException.expires_at.desc())
            .limit(1)
        )).scalars().first()
    standard_window = season.status == "active" and (not closes or now <= closes)
    can_submit = (not opens or now >= opens) and (standard_window or extension is not None)
    if extension:
        message = f"Для вас действует индивидуальный срок до {utc_aware(extension.expires_at).strftime('%d.%m.%Y %H:%M')}."
    elif can_submit:
        message = None
    else:
        message = "Приём документов текущего сезона закрыт."
    return {
        "season": _serialize_season(season),
        "can_submit": can_submit,
        "message": message,
        "individual_submission_deadline": extension.expires_at.isoformat() if extension else None,
    }


@router.get("/comparison")
async def compare_seasons(current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_staff(current_user)
    seasons = (await db.execute(select(Season).order_by(Season.start_at.asc(), Season.id.asc()))).scalars().all()
    rows = []
    for season in seasons:
        stats = (await db.execute(
            select(
                func.count(Achievement.id).label("documents"),
                func.count(func.distinct(Achievement.user_id)).label("participants"),
                func.count(Achievement.id).filter(effective_approved_condition()).label("approved"),
                func.coalesce(func.sum(Achievement.points).filter(effective_approved_condition()), 0).label("points"),
            ).where(Achievement.season_id == season.id)
        )).first()
        documents = int(stats.documents or 0)
        approved = int(stats.approved or 0)
        rows.append({
            **_serialize_season(season),
            "documents": documents,
            "participants": int(stats.participants or 0),
            "approved": approved,
            "approval_rate": round((approved / documents) * 100) if documents else 0,
            "points": int(stats.points or 0),
        })
    return {"seasons": rows}


async def _http_service_status(url: str, *, headers: dict[str, str] | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
        if response.status_code in {401, 403}:
            status = "auth"
        elif response.is_success or response.is_redirect:
            status = "ok"
        else:
            status = "down"
        return {"status": status, "http_status": response.status_code}
    except Exception:
        return {"status": "down", "http_status": None}


@router.get("/system-health")
async def system_health(current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    """Dependency snapshot for the super-admin dashboard; no secrets are returned."""
    _require_super_admin(current_user)

    async def database_status() -> dict:
        try:
            await db.execute(text("SELECT 1"))
            return {"status": "ok"}
        except Exception:
            return {"status": "down"}

    async def redis_status() -> dict:
        try:
            await asyncio.wait_for(get_redis().ping(), timeout=3)
            return {"status": "ok"}
        except Exception:
            return {"status": "down"}

    async def storage_status() -> dict:
        try:
            await asyncio.wait_for(storage.ping(), timeout=4)
            return {"status": "ok"}
        except Exception:
            return {"status": "down"}

    llm_headers = {"Authorization": f"Bearer {settings.LOCAL_LLM_API_KEY}"} if settings.LOCAL_LLM_API_KEY else None
    database, redis, minio, llm, ocr, epoch = await asyncio.gather(
        database_status(),
        redis_status(),
        storage_status(),
        _http_service_status(f"{settings.LOCAL_LLM_BASE_URL.rstrip('/')}/models", headers=llm_headers),
        _http_service_status(f"{settings.AI_SERVICE_URL.rstrip('/')}/health"),
        _http_service_status(EPOCH_HEALTH_URL),
    )
    open_reports = int(await db.scalar(select(func.count(BugReport.id)).where(BugReport.status == "open")) or 0)
    reports_with_session = int(await db.scalar(
        select(func.count(BugReport.id)).where(BugReport.status == "open", BugReport.session_id.isnot(None))
    ) or 0)
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "services": {
            "api": {"status": "ok"},
            "database": database,
            "redis": redis,
            "minio": minio,
            "llm": llm,
            "ocr": ocr,
            "epoch": epoch,
        },
        "diagnostics": {
            "open_bug_reports": open_reports,
            "reports_with_session": reports_with_session,
        },
    }


@router.post("")
@router.post("/")
async def create_season(
    payload: SeasonCreatePayload,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    clean_name = payload.name.strip()
    if await db.scalar(select(Season.id).where(Season.name == clean_name)):
        raise HTTPException(status_code=409, detail="Сезон с таким названием уже существует.")
    base_slug = _slugify(clean_name)
    slug = base_slug
    suffix = 2
    while await db.scalar(select(Season.id).where(Season.slug == slug)):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    season = Season(
        name=clean_name,
        slug=slug,
        status="draft",
        start_at=payload.start_at,
        submissions_open_at=payload.submissions_open_at,
        submissions_close_at=payload.submissions_close_at,
        moderation_close_at=payload.moderation_close_at,
        scoring_rules_version=payload.scoring_rules_version.strip(),
        created_by_id=current_user.id,
    )
    db.add(season)
    await db.flush()
    await log_action(db, current_user.id, "season.create", "season", season.id, season.name)
    await db.commit()
    await db.refresh(season)
    return {"season": _serialize_season(season)}


@router.patch("/{season_id}")
async def update_season(
    season_id: int,
    payload: SeasonUpdatePayload,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id, with_for_update=True)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    if season.status in {"published", "archived"}:
        raise HTTPException(status_code=409, detail="Опубликованный или архивный сезон изменять нельзя.")

    clean_name = payload.name.strip()
    duplicate = await db.scalar(select(Season.id).where(Season.name == clean_name, Season.id != season.id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Сезон с таким названием уже существует.")

    if clean_name != season.name:
        base_slug = _slugify(clean_name)
        slug = base_slug
        suffix = 2
        while await db.scalar(select(Season.id).where(Season.slug == slug, Season.id != season.id)):
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        season.slug = slug

    season.name = clean_name
    season.start_at = payload.start_at
    season.submissions_open_at = payload.submissions_open_at
    season.submissions_close_at = payload.submissions_close_at
    season.moderation_close_at = payload.moderation_close_at
    season.scoring_rules_version = payload.scoring_rules_version.strip()
    await log_action(db, current_user.id, "season.update", "season", season.id, season.name)
    await db.commit()
    await db.refresh(season)
    await invalidate_scoreboard_caches()
    return {"season": _serialize_season(season)}


@router.post("/{season_id}/activate")
async def activate_season(season_id: int, current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id, with_for_update=True)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    if season.status not in {"draft", "scheduled"}:
        raise HTTPException(status_code=409, detail="Активировать можно только подготовленный сезон.")
    live = await get_live_season(db, lock=True)
    if live and live.id != season.id:
        raise HTTPException(status_code=409, detail=f"Сначала завершите сезон «{live.name}».")
    season.status = "active"
    await log_action(db, current_user.id, "season.activate", "season", season.id, season.name)
    await db.commit()
    await invalidate_scoreboard_caches()
    return {"season": _serialize_season(season)}


@router.post("/{season_id}/close-submissions")
async def close_submissions(season_id: int, current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id, with_for_update=True)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    if season.status != "active":
        raise HTTPException(status_code=409, detail="Приём документов уже закрыт.")
    season.status = "moderation"
    now = datetime.now(timezone.utc)
    close_at = utc_aware(season.submissions_close_at)
    season.submissions_close_at = min(close_at or now, now)
    await log_action(db, current_user.id, "season.close_submissions", "season", season.id, season.name)
    await db.commit()
    return {"season": _serialize_season(season)}


@router.post("/{season_id}/exceptions")
async def grant_exception(
    season_id: int,
    payload: SeasonExceptionPayload,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id)
    user = await db.get(Users, payload.user_id)
    if not season or not user or user.role != UserRole.STUDENT:
        raise HTTPException(status_code=404, detail="Сезон или студент не найден.")
    if season.status not in {"active", "moderation"}:
        raise HTTPException(status_code=409, detail="Индивидуальный срок можно назначить только для текущего сезона.")
    expires_at = utc_aware(payload.expires_at)
    if not expires_at or expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Продление должно заканчиваться в будущем.")
    exception = (await db.execute(
        select(SeasonSubmissionException)
        .where(
            SeasonSubmissionException.season_id == season.id,
            SeasonSubmissionException.user_id == user.id,
            SeasonSubmissionException.active.is_(True),
        )
        .order_by(SeasonSubmissionException.id.desc())
        .limit(1)
    )).scalars().first()
    if exception:
        exception.expires_at = expires_at
        exception.reason = payload.reason.strip()
        exception.created_by_id = current_user.id
    else:
        exception = SeasonSubmissionException(
            season_id=season.id,
            user_id=user.id,
            expires_at=expires_at,
            reason=payload.reason.strip(),
            created_by_id=current_user.id,
        )
        db.add(exception)
    await log_action(db, current_user.id, "season.grant_extension", "season", season.id, f"user={user.id}; {payload.reason}")
    await db.commit()
    await db.refresh(exception)
    return {"exception": {
        "id": exception.id,
        "season_id": exception.season_id,
        "user_id": user.id,
        "user_name": f"{user.first_name} {user.last_name}",
        "user_email": user.email,
        "expires_at": exception.expires_at.isoformat(),
        "reason": exception.reason,
        "active": exception.active,
    }}


@router.get("/{season_id}/exceptions")
async def list_exceptions(season_id: int, current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_super_admin(current_user)
    if not await db.get(Season, season_id):
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    rows = (await db.execute(
        select(SeasonSubmissionException, Users)
        .join(Users, Users.id == SeasonSubmissionException.user_id)
        .where(
            SeasonSubmissionException.season_id == season_id,
            SeasonSubmissionException.active.is_(True),
        )
        .order_by(SeasonSubmissionException.expires_at.asc(), SeasonSubmissionException.id.asc())
    )).all()
    return {"exceptions": [{
        "id": exception.id,
        "season_id": exception.season_id,
        "user_id": user.id,
        "user_name": f"{user.first_name} {user.last_name}",
        "user_email": user.email,
        "expires_at": exception.expires_at.isoformat(),
        "reason": exception.reason,
        "active": exception.active,
    } for exception, user in rows]}


@router.delete("/{season_id}/exceptions/{exception_id}")
async def revoke_exception(
    season_id: int,
    exception_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _require_super_admin(current_user)
    exception = await db.get(SeasonSubmissionException, exception_id, with_for_update=True)
    if not exception or exception.season_id != season_id:
        raise HTTPException(status_code=404, detail="Индивидуальный срок не найден.")
    exception.active = False
    await log_action(db, current_user.id, "season.revoke_extension", "season", season_id, f"user={exception.user_id}")
    await db.commit()
    return {"success": True}


@router.post("/{season_id}/finalize")
async def finalize_season(season_id: int, current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id, with_for_update=True)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    if season.status != "moderation":
        raise HTTPException(status_code=409, detail="Сначала закройте приём документов и завершите модерацию.")

    unresolved = int(await db.scalar(
        select(func.count(Achievement.id)).where(
            Achievement.season_id == season.id,
            Achievement.status.in_([AchievementStatus.PENDING, AchievementStatus.REVISION]),
        )
    ) or 0)
    moderation_close_at = utc_aware(season.moderation_close_at)
    if unresolved and moderation_close_at and datetime.now(timezone.utc) < moderation_close_at:
        raise HTTPException(
            status_code=409,
            detail=f"В сезоне остаётся {unresolved} нерешённых документов. Дождитесь окончания модерации или обработайте их.",
        )

    now = datetime.now(timezone.utc)
    await db.execute(
        update(Achievement)
        .where(
            Achievement.season_id == season.id,
            Achievement.status.in_([AchievementStatus.PENDING, AchievementStatus.REVISION]),
        )
        .values(eligible_for_ranking=False, season_disposition="not_counted", moderator_id=None)
    )

    await db.execute(delete(SeasonResult).where(SeasonResult.season_id == season.id))
    await db.execute(delete(SeasonCategoryResult).where(SeasonCategoryResult.season_id == season.id))

    total_points = (
        func.coalesce(func.sum(Achievement.points), 0)
        + aggregated_gpa_bonus_expr(Users.session_gpa)
    ).label("points")
    overall_rows = (await db.execute(
        select(
            Users.id,
            total_points,
            func.count(Achievement.id).label("achievements_count"),
        )
        .join(
            Achievement,
            (Achievement.user_id == Users.id)
            & (Achievement.season_id == season.id)
            & effective_approved_condition(),
            isouter=True,
        )
        .where(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
        .group_by(Users.id)
        .having(total_points > 0)
        .order_by(desc("points"), Users.id.asc())
    )).all()

    category_rows = (await db.execute(
        select(
            Achievement.user_id,
            Achievement.category,
            func.coalesce(func.sum(Achievement.points), 0).label("points"),
        )
        .where(Achievement.season_id == season.id, effective_approved_condition())
        .group_by(Achievement.user_id, Achievement.category)
    )).all()
    categories_by_user: dict[int, dict[str, int]] = {}
    categories: dict[str, list[tuple[int, int]]] = {}
    for row in category_rows:
        category = row.category.value if hasattr(row.category, "value") else str(row.category)
        points = int(row.points or 0)
        categories_by_user.setdefault(row.user_id, {})[category] = points
        categories.setdefault(category, []).append((row.user_id, points))

    for rank, row in enumerate(overall_rows, 1):
        db.add(SeasonResult(
            season_id=season.id,
            user_id=row.id,
            season_name=season.name,
            points=int(row.points or 0),
            rank=rank,
            achievements_count=int(row.achievements_count or 0),
            category_points=categories_by_user.get(row.id, {}),
            published_at=now,
        ))
    for category, values in categories.items():
        for rank, (user_id, points) in enumerate(sorted(values, key=lambda item: (-item[1], item[0])), 1):
            if points > 0:
                db.add(SeasonCategoryResult(
                    season_id=season.id,
                    user_id=user_id,
                    category=category,
                    points=points,
                    rank=rank,
                    published_at=now,
                ))

    await db.execute(
        update(Achievement)
        .where(Achievement.season_id == season.id)
        .values(archived_season=season.name)
    )
    await db.execute(update(Users).where(Users.role == UserRole.STUDENT).values(session_gpa=None))
    season.status = "published"
    season.finalized_at = now
    season.results_published_at = now
    await log_action(db, current_user.id, "season.finalize", "season", season.id, f"{season.name}; unresolved={unresolved}")
    await db.commit()
    await invalidate_scoreboard_caches()
    return {"season": _serialize_season(season), "participants": len(overall_rows), "not_counted": unresolved}


@router.post("/{season_id}/archive")
async def archive_season(season_id: int, current_user=Depends(auth), db: AsyncSession = Depends(get_db)):
    _require_super_admin(current_user)
    season = await db.get(Season, season_id, with_for_update=True)
    if not season:
        raise HTTPException(status_code=404, detail="Сезон не найден.")
    if season.status != "published":
        raise HTTPException(status_code=409, detail="Архивировать можно только опубликованный сезон.")
    season.status = "archived"
    season.archived_at = datetime.now(timezone.utc)
    await log_action(db, current_user.id, "season.archive", "season", season.id, season.name)
    await db.commit()
    return {"season": _serialize_season(season)}
