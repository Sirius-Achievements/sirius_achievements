from __future__ import annotations

import os
from math import ceil

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementCategory, AchievementLevel, AchievementResult, AchievementStatus, UserStatus
from app.repositories.admin.achievement_repository import AchievementRepository
from app.services.admin.achievement_service import AchievementService
from app.utils.rate_limiter import rate_limiter
from app.utils.search import escape_like

from .serializers import serialize_achievement

router = APIRouter(prefix='/api/v1/achievements', tags=['api.v1.achievements'])


PAGE_SIZE = 10


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
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    stmt = select(Achievement).filter(Achievement.user_id == current_user.id)

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
    }


@router.get('/search')
async def search_achievements(
    q: str = Query(..., min_length=1),
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
    file: UploadFile | None = File(None),
    current_user=Depends(auth),
    service: AchievementService = Depends(get_service),
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
        }
        if resolved_result:
            create_data['result'] = resolved_result

        achievement = await service.create(create_data)
        return {'achievement': serialize_achievement(achievement)}
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
):
    _ensure_account_not_deleted(current_user)

    achievement = await service.repo.find(achievement_id)
    if not achievement or achievement.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Достижение не найдено.')
    if achievement.status != AchievementStatus.REVISION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Этот документ не требует доработки.')

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
            new_file_path = await service.save_file(file)
            old_file_full_path = os.path.join(service.upload_dir, achievement.file_path)
            if os.path.exists(old_file_full_path):
                try:
                    os.remove(old_file_full_path)
                except OSError:
                    pass
            update_data['file_path'] = new_file_path

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
        await service.delete(achievement_id, current_user.id, current_user.role)
        return {'success': True}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Удаление документа недоступно.') from exc
