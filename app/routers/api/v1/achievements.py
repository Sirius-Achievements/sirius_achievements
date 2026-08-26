from __future__ import annotations

import os
from datetime import date, datetime, timezone
from hashlib import sha256
from math import ceil

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementCategory, AchievementLevel, AchievementResult, AchievementStatus, UserStatus
from app.models.season import Season
from app.repositories.admin.achievement_repository import AchievementRepository
from app.services.admin.achievement_service import AchievementService
from app.services.season_service import (
    SeasonRuleError,
    ensure_revision_allowed,
    get_active_submission_season,
    get_live_season,
)
from app.utils.rate_limiter import rate_limiter
from app.utils.search import escape_like

from .serializers import serialize_achievement

router = APIRouter(prefix='/api/v1/achievements', tags=['api.v1.achievements'])


PAGE_SIZE = 10


async def _upload_hash(file: UploadFile | None) -> str | None:
    if not file or not getattr(file, 'filename', None):
        return None
    content = await file.read()
    await file.seek(0)
    return sha256(content).hexdigest()


def _ensure_account_not_deleted(current_user) -> None:
    if current_user.status == UserStatus.DELETED:
        raise HTTPException(status_code=403, detail='Аккаунт удалён. Доступна только поддержка.')


def get_service(db: AsyncSession = Depends(get_db)):
    return AchievementService(AchievementRepository(db))


def _resolve_enum(enum_cls, raw: str | None) -> str | None:
    if raw is None:
        return None

    key = raw.upper()
    if key in enum_cls.__members__:
        return key

    for member in enum_cls:
        if member.value == raw:
            return member.name

    return None


@router.get('')
@router.get('/')
async def list_achievements(
    page: int = Query(1, ge=1, le=1000),
    query: str | None = Query(None),
    status_value: str | None = Query(None, alias='status'),
    category: str | None = Query(None),
    level: str | None = Query(None),
    result_value: str | None = Query(None, alias='result'),
    sort_by: str = Query('newest'),
    season: str = Query('current', max_length=100),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    stmt = select(Achievement).filter(Achievement.user_id == current_user.id)

    archived_seasons = (await db.execute(
        select(Season)
        .where(Season.status.in_(['published', 'archived']))
        .order_by(Season.start_at.desc(), Season.id.desc())
    )).scalars().all()
    archived_names = [item.name for item in archived_seasons]
    archived_by_name = {item.name: item.id for item in archived_seasons}
    live_season = await get_live_season(db)
    if season == 'current':
        stmt = stmt.filter(Achievement.season_id == live_season.id) if live_season else stmt.filter(Achievement.archived_season.is_(None))
    elif season == 'last2':
        selected_ids = ([live_season.id] if live_season else []) + [item.id for item in archived_seasons[:1]]
        stmt = stmt.filter(Achievement.season_id.in_(selected_ids)) if selected_ids else stmt.filter(False)
    elif season != 'all':
        selected_id = archived_by_name.get(season)
        if not selected_id:
            raise HTTPException(status_code=422, detail='Неизвестный сезон.')
        stmt = stmt.filter(Achievement.season_id == selected_id)

    if query:
        like_term = f"%{escape_like(query)}%"
        stmt = stmt.filter(or_(Achievement.title.ilike(like_term), Achievement.description.ilike(like_term)))
    if status_value and status_value != 'all':
        stmt = stmt.filter(Achievement.status == status_value)
    if category and category != 'all':
        stmt = stmt.filter(Achievement.category == category)
    if level and level != 'all':
        stmt = stmt.filter(Achievement.level == level)
    if result_value and result_value != 'all':
        stmt = stmt.filter(Achievement.result == result_value)

    if sort_by == 'oldest':
        stmt = stmt.order_by(Achievement.created_at.asc())
    elif sort_by == 'category':
        stmt = stmt.order_by(Achievement.category.asc())
    elif sort_by == 'level':
        level_order = case(
            (Achievement.level == AchievementLevel.INTERNATIONAL, 5),
            (Achievement.level == AchievementLevel.FEDERAL, 4),
            (Achievement.level == AchievementLevel.REGIONAL, 3),
            (Achievement.level == AchievementLevel.MUNICIPAL, 2),
            (Achievement.level == AchievementLevel.SCHOOL, 1),
            else_=0,
        )
        stmt = stmt.order_by(level_order.desc())
    elif sort_by == 'result':
        result_order = case(
            (Achievement.result == AchievementResult.WINNER, 3),
            (Achievement.result == AchievementResult.PRIZEWINNER, 2),
            (Achievement.result == AchievementResult.PARTICIPANT, 1),
            else_=0,
        )
        stmt = stmt.order_by(result_order.desc(), Achievement.created_at.desc())
    elif sort_by == 'title':
        stmt = stmt.order_by(Achievement.title.asc(), Achievement.created_at.desc())
    else:
        stmt = stmt.order_by(Achievement.created_at.desc())

    total_items = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    achievements = (await db.execute(stmt.offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE))).scalars().all()

    return {
        'achievements': [serialize_achievement(item) for item in achievements],
        'page': page,
        'total_pages': max(1, ceil(total_items / PAGE_SIZE)),
        'selected_season': season,
        'available_seasons': archived_names,
    }


@router.get('/search')
async def search_achievements(
    q: str = Query(..., min_length=1),
    season: str = Query('current', max_length=100),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    like_term = f"%{escape_like(q)}%"
    stmt = (
        select(Achievement)
        .filter(Achievement.user_id == current_user.id)
        .filter(or_(Achievement.title.ilike(like_term), Achievement.description.ilike(like_term)))
        .limit(5)
    )
    live_season = await get_live_season(db)
    archived_seasons = (await db.execute(
        select(Season).where(Season.status.in_(['published', 'archived'])).order_by(Season.start_at.desc(), Season.id.desc())
    )).scalars().all()
    if season == 'current':
        stmt = stmt.filter(Achievement.season_id == live_season.id) if live_season else stmt.filter(Achievement.archived_season.is_(None))
    elif season == 'last2':
        selected_ids = ([live_season.id] if live_season else []) + [item.id for item in archived_seasons[:1]]
        stmt = stmt.filter(Achievement.season_id.in_(selected_ids)) if selected_ids else stmt.filter(False)
    elif season != 'all' and season != 'last2':
        selected_id = next((item.id for item in archived_seasons if item.name == season), None)
        if not selected_id:
            raise HTTPException(status_code=422, detail='Неизвестный сезон.')
        stmt = stmt.filter(Achievement.season_id == selected_id)
    result = await db.execute(stmt)
    achievements = result.scalars().all()
    return [{'value': item.title, 'text': item.title} for item in achievements]


@router.post('')
@router.post('/')
async def create_achievement(
    title: str = Form(..., min_length=1, max_length=200),
    description: str | None = Form(None, max_length=2000),
    category: str = Form(..., max_length=50),
    level: str = Form(..., max_length=50),
    result: str | None = Form(None, max_length=50),
    external_url: str | None = Form(None, max_length=500),
    event_date: date = Form(...),
    file: UploadFile | None = File(None),
    current_user=Depends(auth),
    service: AchievementService = Depends(get_service),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    rl_key = f'upload_rl:{current_user.id}'
    upload_count = int(await rate_limiter.increment(rl_key, settings.UPLOAD_RATE_TTL))
    if upload_count > settings.UPLOAD_MAX_PER_HOUR:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много загрузок. Попробуйте позже.')

    resolved_category = _resolve_enum(AchievementCategory, category)
    resolved_level = _resolve_enum(AchievementLevel, level)
    resolved_result = _resolve_enum(AchievementResult, result) if result else None

    if not resolved_category or not resolved_level:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Некорректная категория или уровень.')

    cleaned_url = (external_url or '').strip() or None
    has_file = bool(file and getattr(file, 'filename', None))

    if not has_file and not cleaned_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Прикрепите файл или укажите ссылку.')

    if cleaned_url and not (cleaned_url.startswith('http://') or cleaned_url.startswith('https://')):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Ссылка должна начинаться с http:// или https://.')

    try:
        season = await get_active_submission_season(
            db,
            user_id=current_user.id,
            event_date=event_date,
        )
        file_hash = await _upload_hash(file if has_file else None)
        if file_hash:
            duplicate = await db.scalar(
                select(Achievement.id).where(
                    Achievement.user_id == current_user.id,
                    Achievement.file_hash == file_hash,
                ).limit(1)
            )
            if duplicate:
                raise HTTPException(status_code=409, detail='Этот файл уже загружен. Откройте существующий документ вместо повторной отправки.')
        file_path = await service.save_file(file) if has_file else None
        create_data = {
            'user_id': current_user.id,
            'title': title,
            'description': description,
            'file_path': file_path,
            'external_url': cleaned_url,
            'category': resolved_category,
            'level': resolved_level,
            'status': AchievementStatus.PENDING,
            'season_id': season.id,
            'event_date': event_date,
            'submitted_at': datetime.now(timezone.utc),
            'file_hash': file_hash,
            'eligible_for_ranking': True,
            'season_disposition': 'eligible',
        }
        if resolved_result:
            create_data['result'] = resolved_result

        achievement = await service.create(create_data)
        return {'achievement': serialize_achievement(achievement)}
    except SeasonRuleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Не удалось загрузить документ. Проверьте файл и повторите попытку.') from exc


@router.put('/{achievement_id}/revise')
async def revise_achievement(
    achievement_id: int,
    title: str | None = Form(None, max_length=200),
    description: str | None = Form(None, max_length=2000),
    file: UploadFile | None = File(None),
    current_user=Depends(auth),
    service: AchievementService = Depends(get_service),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    achievement = await service.repo.find(achievement_id)
    if not achievement or achievement.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Достижение не найдено.')
    if achievement.status != AchievementStatus.REVISION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Этот документ не требует доработки.')
    season = await db.get(Season, achievement.season_id) if achievement.season_id else None
    try:
        ensure_revision_allowed(season)
    except SeasonRuleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    update_data = {
        'status': AchievementStatus.PENDING,
        'rejection_reason': None,
    }

    if title is not None and title.strip():
        update_data['title'] = title.strip()
    if description is not None:
        update_data['description'] = description.strip() if description.strip() else None

    try:
        if file and file.filename:
            file_hash = await _upload_hash(file)
            duplicate = await db.scalar(
                select(Achievement.id).where(
                    Achievement.user_id == current_user.id,
                    Achievement.file_hash == file_hash,
                    Achievement.id != achievement.id,
                ).limit(1)
            )
            if duplicate:
                raise HTTPException(status_code=409, detail='Этот файл уже использован в другом документе.')
            new_file_path = await service.save_file(file)
            old_file_full_path = os.path.join(service.upload_dir, achievement.file_path)
            if os.path.exists(old_file_full_path):
                try:
                    os.remove(old_file_full_path)
                except OSError:
                    pass
            update_data['file_path'] = new_file_path
            update_data['file_hash'] = file_hash
        update_data['submitted_at'] = datetime.now(timezone.utc)

        await service.repo.update(achievement_id, update_data)
        updated = await service.repo.find(achievement_id)
        return {'achievement': serialize_achievement(updated)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Не удалось обновить документ. Проверьте данные и повторите попытку.') from exc


@router.delete('/{achievement_id}')
async def delete_achievement(
    achievement_id: int,
    current_user=Depends(auth),
    service: AchievementService = Depends(get_service),
):
    _ensure_account_not_deleted(current_user)

    achievement = await service.repo.find(achievement_id)
    if not achievement or achievement.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Достижение не найдено.')

    try:
        action = await service.delete(achievement_id, current_user.id, current_user.role)
        return {'success': True, 'action': action}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Удаление документа недоступно.') from exc
