from __future__ import annotations

from datetime import datetime, timezone
import math

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementCategory, AchievementLevel, AchievementResult, AchievementStatus, UserRole, UserStatus
from app.models.user import Users
from app.services.audit_service import log_action
from app.services.points_calculator import calculate_points
from app.services.ws_manager import ws_manager
from app.utils.access import is_in_zone
from app.utils.notifications import make_notification, serialize_notification
from app.utils.search import escape_like

from .serializers import serialize_achievement, serialize_user

router = APIRouter(prefix='/api/v1/moderation', tags=['api.v1.moderation'])


class AchievementDecisionPayload(BaseModel):
    status: str
    rejection_reason: str | None = None


class AchievementMetadataPayload(BaseModel):
    title: str
    description: str | None = None
    category: str | None = None
    level: str | None = None
    result: str | None = None


class BatchAchievementPayload(BaseModel):
    ids: list[int]
    action: str


async def require_moderator(current_user=Depends(auth)):
    if current_user.role not in {UserRole.MODERATOR, UserRole.SUPER_ADMIN}:
        raise HTTPException(status_code=403, detail='Access denied')
    return current_user


def _split_csv(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(',') if item.strip()}


def _apply_moderator_scope(stmt, current_user):
    if current_user.role != UserRole.MODERATOR:
        return stmt
    if current_user.education_level:
        stmt = stmt.filter(Users.education_level == current_user.education_level)
    courses = _split_csv(getattr(current_user, 'moderator_courses', None))
    if courses:
        stmt = stmt.filter(Users.course.in_([int(item) for item in courses if item.isdigit()]))
    groups = _split_csv(getattr(current_user, 'moderator_groups', None))
    if groups:
        stmt = stmt.filter(Users.study_group.in_(groups))
    return stmt


def _is_user_in_moderator_scope(current_user, target_user) -> bool:
    return is_in_zone(
        current_user,
        getattr(target_user, 'education_level', None),
        getattr(target_user, 'course', None),
        getattr(target_user, 'study_group', None),
    )


def _is_achievement_in_moderator_scope(current_user, achievement) -> bool:
    return _is_user_in_moderator_scope(current_user, getattr(achievement, 'user', None))


@router.get('/users')
async def pending_users(
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Users).filter(Users.status == UserStatus.PENDING)
    stmt = _apply_moderator_scope(stmt, current_user)

    stmt = stmt.order_by(Users.id.desc())
    users = (await db.execute(stmt)).scalars().all()
    return {
        'users': [serialize_user(user) for user in users],
        'total_count': len(users),
    }


@router.post('/users/{user_id}/approve')
async def approve_user(
    user_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    target_user = await db.get(Users, user_id)
    if not target_user or not _is_user_in_moderator_scope(current_user, target_user):
        raise HTTPException(status_code=404, detail='User not found in your moderation zone')

    target_user.status = UserStatus.ACTIVE
    target_user.role = UserRole.STUDENT
    target_user.reviewed_by_id = None
    await log_action(db, current_user.id, 'user.approve', 'user', user_id)
    await db.commit()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.post('/users/{user_id}/reject')
async def reject_user(
    user_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    target_user = await db.get(Users, user_id)
    if not target_user or not _is_user_in_moderator_scope(current_user, target_user):
        raise HTTPException(status_code=404, detail='User not found in your moderation zone')

    target_user.status = UserStatus.REJECTED
    target_user.reviewed_by_id = None
    await log_action(db, current_user.id, 'user.reject', 'user', user_id)
    await db.commit()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.post('/users/{user_id}/take')
async def take_user(
    user_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    target_user = await db.get(Users, user_id)
    if not target_user or target_user.status != UserStatus.PENDING:
        raise HTTPException(status_code=404, detail='User not found or already processed')
    if not _is_user_in_moderator_scope(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')
    if target_user.reviewed_by_id and target_user.reviewed_by_id != current_user.id:
        raise HTTPException(status_code=409, detail='User is already assigned to another moderator')

    target_user.reviewed_by_id = current_user.id
    await log_action(db, current_user.id, 'user.take', 'user', user_id)
    await db.commit()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.post('/users/{user_id}/release')
async def release_user(
    user_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    target_user = await db.get(Users, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail='User not found')
    if current_user.role != UserRole.SUPER_ADMIN and target_user.reviewed_by_id != current_user.id:
        raise HTTPException(status_code=403, detail='Access denied')
    if not _is_user_in_moderator_scope(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')

    target_user.reviewed_by_id = None
    await log_action(db, current_user.id, 'user.release', 'user', user_id)
    await db.commit()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.get('/achievements')
async def pending_achievements(
    page: int = Query(default=1, ge=1, le=1000),
    query: str = Query(default=''),
    category: str = Query(default=''),
    level: str = Query(default=''),
    result: str = Query(default=''),
    categories: list[str] | None = Query(default=None),
    levels: list[str] | None = Query(default=None),
    results: list[str] | None = Query(default=None),
    sort_by: str = Query(default='oldest'),
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    limit = settings.ITEMS_PER_PAGE
    offset = (page - 1) * limit

    stmt = (
        select(Achievement)
        .join(Users, Achievement.user_id == Users.id)
        .options(selectinload(Achievement.user))
        .filter(Achievement.status == AchievementStatus.PENDING)
    )

    stmt = _apply_moderator_scope(stmt, current_user)

    if query:
        like_term = f"%{escape_like(query)}%"
        stmt = stmt.filter(
            or_(
                Achievement.title.ilike(like_term),
                Achievement.description.ilike(like_term),
                Users.first_name.ilike(like_term),
                Users.last_name.ilike(like_term),
                Users.email.ilike(like_term),
                (Users.first_name + ' ' + Users.last_name).ilike(like_term),
            )
        )

    if categories:
        stmt = stmt.filter(Achievement.category.in_(categories))
    elif category and category != 'all':
        stmt = stmt.filter(Achievement.category == category)
    if levels:
        stmt = stmt.filter(Achievement.level.in_(levels))
    elif level and level != 'all':
        stmt = stmt.filter(Achievement.level == level)
    if results:
        stmt = stmt.filter(Achievement.result.in_(results))
    elif result and result != 'all':
        stmt = stmt.filter(Achievement.result == result)

    if sort_by == 'newest':
        stmt = stmt.order_by(Achievement.created_at.desc())
    elif sort_by == 'category':
        stmt = stmt.order_by(Achievement.category.asc(), Achievement.created_at.desc())
    elif sort_by == 'level':
        level_order = case(
            (Achievement.level == AchievementLevel.INTERNATIONAL, 5),
            (Achievement.level == AchievementLevel.FEDERAL, 4),
            (Achievement.level == AchievementLevel.REGIONAL, 3),
            (Achievement.level == AchievementLevel.MUNICIPAL, 2),
            (Achievement.level == AchievementLevel.SCHOOL, 1),
            else_=0,
        )
        stmt = stmt.order_by(level_order.desc(), Achievement.created_at.desc())
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
        stmt = stmt.order_by(Achievement.created_at.asc())

    total_pending = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    achievements = (await db.execute(stmt.offset(offset).limit(limit))).scalars().all()

    for item in achievements:
        if item.level and item.category:
            item.projected_points = calculate_points(
                item.level.value,
                item.category.value,
                item.result.value if item.result else None,
            )
        else:
            item.projected_points = 0

    return {
        'achievements': [serialize_achievement(item) for item in achievements],
        'stats': {'total_pending': int(total_pending)},
        'page': page,
        'total_pages': math.ceil(total_pending / limit) if total_pending > 0 else 1,
    }


@router.post('/achievements/{achievement_id}/take')
async def take_achievement(
    achievement_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Achievement).options(selectinload(Achievement.user)).where(Achievement.id == achievement_id)
    achievement = (await db.execute(stmt)).scalars().first()
    if not achievement or achievement.status != AchievementStatus.PENDING:
        raise HTTPException(status_code=404, detail='Achievement not found or already processed')
    if not _is_achievement_in_moderator_scope(current_user, achievement):
        raise HTTPException(status_code=403, detail='Access denied')
    if achievement.moderator_id and achievement.moderator_id != current_user.id:
        raise HTTPException(status_code=409, detail='Achievement is already assigned to another moderator')

    achievement.moderator_id = current_user.id
    await log_action(db, current_user.id, 'achievement.take', 'achievement', achievement_id)
    await db.commit()
    await db.refresh(achievement)
    refreshed = (await db.execute(stmt)).scalars().first()
    return {'success': True, 'achievement': serialize_achievement(refreshed)}


@router.post('/achievements/{achievement_id}/release')
async def release_achievement(
    achievement_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Achievement).options(selectinload(Achievement.user)).where(Achievement.id == achievement_id)
    achievement = (await db.execute(stmt)).scalars().first()
    if not achievement:
        raise HTTPException(status_code=404, detail='Achievement not found')
    if current_user.role != UserRole.SUPER_ADMIN and achievement.moderator_id != current_user.id:
        raise HTTPException(status_code=403, detail='Access denied')
    if not _is_achievement_in_moderator_scope(current_user, achievement):
        raise HTTPException(status_code=403, detail='Access denied')

    achievement.moderator_id = None
    await log_action(db, current_user.id, 'achievement.release', 'achievement', achievement_id)
    await db.commit()
    await db.refresh(achievement)
    refreshed = (await db.execute(stmt)).scalars().first()
    return {'success': True, 'achievement': serialize_achievement(refreshed)}


@router.patch('/achievements/{achievement_id}/metadata')
async def update_achievement_metadata(
    achievement_id: int,
    payload: AchievementMetadataPayload,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Achievement)
        .options(selectinload(Achievement.user))
        .where(Achievement.id == achievement_id)
        .with_for_update()
    )
    achievement = (await db.execute(stmt)).scalars().first()

    if not achievement:
        raise HTTPException(status_code=404, detail='Achievement not found')
    if not _is_achievement_in_moderator_scope(current_user, achievement):
        raise HTTPException(status_code=403, detail='Access denied')
    if achievement.status != AchievementStatus.PENDING:
        raise HTTPException(status_code=409, detail='Only pending achievements can be edited')
    if current_user.role != UserRole.SUPER_ADMIN and achievement.moderator_id != current_user.id:
        raise HTTPException(status_code=403, detail='Take the document into work before editing it')

    clean_title = payload.title.strip()
    clean_description = (payload.description or '').strip()

    if not clean_title:
        raise HTTPException(status_code=400, detail='Title is required')

    previous_title = achievement.title
    achievement.title = clean_title
    achievement.description = clean_description or None

    if payload.category is not None:
        try:
            achievement.category = AchievementCategory(payload.category)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid category')

    if payload.level is not None:
        try:
            achievement.level = AchievementLevel(payload.level)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid level')

    if payload.result is not None:
        if payload.result == '':
            achievement.result = None
        else:
            try:
                achievement.result = AchievementResult(payload.result)
            except ValueError:
                raise HTTPException(status_code=400, detail='Invalid result')

    await log_action(
        db,
        current_user.id,
        'achievement.edit_metadata',
        'achievement',
        achievement_id,
        f'{previous_title} -> {achievement.title}',
    )
    await db.commit()
    await db.refresh(achievement)
    refreshed = (await db.execute(stmt)).scalars().first()
    return {'success': True, 'achievement': serialize_achievement(refreshed)}


@router.post('/achievements/{achievement_id}')
async def update_achievement_status(
    achievement_id: int,
    payload: AchievementDecisionPayload,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Achievement)
        .options(selectinload(Achievement.user))
        .where(Achievement.id == achievement_id)
        .with_for_update()
    )
    achievement = (await db.execute(stmt)).scalars().first()

    if not achievement:
        raise HTTPException(status_code=404, detail='Achievement not found')
    if not _is_achievement_in_moderator_scope(current_user, achievement):
        raise HTTPException(status_code=403, detail='Access denied')
    if achievement.status != AchievementStatus.PENDING:
        raise HTTPException(status_code=409, detail='Achievement was already processed by another moderator')

    allowed_statuses = {
        'approved': AchievementStatus.APPROVED,
        'rejected': AchievementStatus.REJECTED,
        'revision': AchievementStatus.REVISION,
    }
    new_status = allowed_statuses.get(payload.status)
    if not new_status:
        raise HTTPException(status_code=400, detail='Unsupported status')

    achievement.status = new_status
    achievement.moderator_id = current_user.id
    notification_message = f"Статус документа «{achievement.title}» обновлён."

    if new_status == AchievementStatus.REJECTED:
        achievement.rejection_reason = payload.rejection_reason
        achievement.points = 0
        notification_message = f"Документ «{achievement.title}» отклонён. Причина: {payload.rejection_reason or '—'}"
    elif new_status == AchievementStatus.REVISION:
        achievement.rejection_reason = payload.rejection_reason
        achievement.points = 0
        notification_message = f"Документ «{achievement.title}» отправлен на доработку. Комментарий: {payload.rejection_reason or '—'}"
    elif new_status == AchievementStatus.APPROVED:
        points = calculate_points(
            achievement.level.value,
            achievement.category.value,
            achievement.result.value if achievement.result else None,
        )
        achievement.points = points
        achievement.rejection_reason = None
        notification_message = f"Документ «{achievement.title}» одобрен. Начислено баллов: {points}."

    notification = make_notification(
        user_id=achievement.user_id,
        title='Статус документа обновлён',
        message=notification_message,
        link='/sirius.achievements/app/achievements',
    )
    db.add(notification)
    await log_action(db, current_user.id, f'achievement.{payload.status}', 'achievement', achievement_id, payload.rejection_reason)
    await db.commit()

    await ws_manager.send_to_user(
        achievement.user_id,
        {'type': 'notification', 'notification': serialize_notification(notification)},
    )

    refreshed = (await db.execute(select(Achievement).options(selectinload(Achievement.user)).where(Achievement.id == achievement_id))).scalars().first()
    return {'success': True, 'achievement': serialize_achievement(refreshed)}


@router.post('/achievements/batch')
async def batch_update_achievements(
    payload: BatchAchievementPayload,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    allowed_actions = {
        'approved': AchievementStatus.APPROVED,
        'rejected': AchievementStatus.REJECTED,
    }
    new_status = allowed_actions.get(payload.action)
    if not new_status:
        raise HTTPException(status_code=400, detail='Unsupported batch action')
    if not payload.ids:
        raise HTTPException(status_code=400, detail='No achievement ids were provided')

    processed = 0
    notifications_to_send: list[tuple[int, object]] = []
    for achievement_id in payload.ids:
        stmt = (
            select(Achievement)
            .options(selectinload(Achievement.user))
            .where(Achievement.id == achievement_id)
            .with_for_update()
        )
        achievement = (await db.execute(stmt)).scalars().first()
        if not achievement or achievement.status != AchievementStatus.PENDING:
            continue
        if not _is_achievement_in_moderator_scope(current_user, achievement):
            continue

        achievement.status = new_status
        achievement.moderator_id = current_user.id
        if new_status == AchievementStatus.APPROVED:
            points = calculate_points(
                achievement.level.value,
                achievement.category.value,
                achievement.result.value if achievement.result else None,
            )
            achievement.points = points
            achievement.rejection_reason = None
            message = f"Документ «{achievement.title}» одобрен. Начислено баллов: {points}."
        else:
            achievement.points = 0
            achievement.rejection_reason = None
            message = f"Документ «{achievement.title}» отклонён."

        notification = make_notification(
            user_id=achievement.user_id,
            title='Статус документа обновлён',
            message=message,
            link='/sirius.achievements/app/achievements',
        )
        db.add(notification)
        notifications_to_send.append((achievement.user_id, notification))
        await log_action(db, current_user.id, f'achievement.batch_{payload.action}', 'achievement', achievement_id)
        processed += 1

    await db.commit()

    for user_id, notification in notifications_to_send:
        await ws_manager.send_to_user(
            user_id,
            {'type': 'notification', 'notification': serialize_notification(notification)},
        )

    return {'success': True, 'count': processed}
