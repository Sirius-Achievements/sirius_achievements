from __future__ import annotations

import math
from pathlib import Path
from textwrap import wrap

import fitz
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import and_, desc, func, literal_column, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementStatus, EducationLevel, UserRole, UserStatus
from app.models.season_result import SeasonResult
from app.models.user import Users
from app.repositories.admin.user_repository import UserRepository
from app.repositories.admin.support_repository import SupportMessageRepository, SupportTicketRepository
from app.services.admin.resume_service import ResumeService
from app.services.admin.smart_search_service import SmartSearchService
from app.services.admin.support_service import SupportService
from app.utils.access import is_in_zone, is_staff_role
from app.utils.cache import invalidate_scoreboard_caches
from app.utils.education import AVAILABLE_EDUCATION_LEVELS, COURSE_MAPPING, GROUP_MAPPING
from app.utils.media_paths import resolve_static_path
from app.utils.notifications import make_notification, serialize_notification
from app.utils.points import aggregated_gpa_bonus_expr, calculate_gpa_bonus
from app.utils.search import escape_like
from app.services.ws_manager import ws_manager

from .serializers import serialize_achievement, serialize_user

router = APIRouter(prefix='/api/v1/users', tags=['api.v1.users'])

ROLE_HIERARCHY = {
    UserRole.GUEST: 0,
    UserRole.STUDENT: 1,
    UserRole.MODERATOR: 2,
    UserRole.SUPER_ADMIN: 3,
}

PDF_FONT_NAME = 'ui_sans'
PDF_TEXT_COLOR = (0, 0, 0)
PDF_FONT_CANDIDATES = (
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
    Path('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'),
    Path('/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf'),
    Path('C:/Windows/Fonts/arial.ttf'),
    Path('C:/Windows/Fonts/segoeui.ttf'),
)


class UpdateRolePayload(BaseModel):
    role: UserRole
    education_level: str | None = None
    moderator_courses: list[int] | None = None
    moderator_groups: list[str] | None = None


class SetGpaPayload(BaseModel):
    gpa: str


class SmartSearchPayload(BaseModel):
    description: str
    education_levels: list[str] | None = None
    courses: list[str] | None = None
    statuses: list[str] | None = None


def get_support_service(db: AsyncSession = Depends(get_db)):
    ticket_repo = SupportTicketRepository(db)
    message_repo = SupportMessageRepository(db)
    return SupportService(ticket_repo, message_repo)


async def _check_admin_rights(current_user=Depends(auth)):
    if current_user.role not in {UserRole.SUPER_ADMIN, UserRole.MODERATOR}:
        raise HTTPException(status_code=403, detail='Access denied')
    return current_user


def _split_csv(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(',') if item.strip()}


def _apply_moderator_user_scope(stmt, current_user):
    if current_user.role != UserRole.MODERATOR:
        return stmt

    # Students the moderator manages: their education-level/course/group zone.
    zone = []
    if current_user.education_level:
        zone.append(Users.education_level == current_user.education_level)

    courses = _split_csv(getattr(current_user, 'moderator_courses', None))
    if courses:
        zone.append(Users.course.in_([int(item) for item in courses if item.isdigit()]))

    groups = _split_csv(getattr(current_user, 'moderator_groups', None))
    if groups:
        zone.append(Users.study_group.in_(groups))

    zone_cond = and_(*zone) if zone else true()
    # Plus every staff member (moderators / super admins), read-only — a
    # moderator may see who the staff are but never edit them (write endpoints
    # stay gated by _can_access_target, which excludes out-of-zone/staff).
    staff_cond = Users.role.in_([UserRole.MODERATOR, UserRole.SUPER_ADMIN])
    return stmt.filter(or_(zone_cond, staff_cond))


def _can_view_target(current_user, target_user) -> bool:
    """Read access: write scope plus read-only visibility of any staff member."""
    if _can_access_target(current_user, target_user):
        return True
    return is_staff_role(getattr(target_user, 'role', None))


def _can_access_target(current_user, target_user) -> bool:
    if current_user.role == UserRole.SUPER_ADMIN:
        return True
    return is_in_zone(
        current_user,
        getattr(target_user, 'education_level', None),
        getattr(target_user, 'course', None),
        getattr(target_user, 'study_group', None),
    )


def _serialize_season_result(item: SeasonResult):
    return {
        'id': item.id,
        'season_name': item.season_name,
        'points': int(item.points or 0),
        'rank': int(item.rank or 0),
        'created_at': item.created_at.isoformat() if item.created_at else None,
    }


def _achievement_status_label(status: str) -> str:
    if status == AchievementStatus.APPROVED:
        return 'Одобрено'
    if status == AchievementStatus.PENDING:
        return 'На проверке'
    if status == AchievementStatus.REJECTED:
        return 'Отклонено'
    if status == AchievementStatus.REVISION:
        return 'На доработке'
    if status == AchievementStatus.ARCHIVED:
        return 'Архив'
    return str(status)


def _user_role_label(role) -> str:
    value = role.value if hasattr(role, 'value') else str(role)
    labels = {
        'GUEST': 'Гость',
        'STUDENT': 'Студент',
        'MODERATOR': 'Модератор',
        'SUPER_ADMIN': 'Админ',
    }
    return labels.get(value, value)


def _user_status_label(status) -> str:
    value = status.value if hasattr(status, 'value') else str(status)
    labels = {
        'active': 'Активен',
        'pending': 'Ожидает',
        'rejected': 'Отклонён',
        'deleted': 'Удалён',
    }
    return labels.get(value, value)


VISIBLE_USER_STATUSES = (
    UserStatus.ACTIVE,
    UserStatus.PENDING,
    UserStatus.DELETED,
)


def _format_ru_date(value) -> str:
    if not value:
        return '—'
    return value.strftime('%d.%m.%Y')


def _format_ru_datetime(value) -> str:
    if not value:
        return '—'
    return value.strftime('%d.%m.%Y %H:%M')


def _resolve_pdf_font_path() -> Path | None:
    for candidate in PDF_FONT_CANDIDATES:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


async def _load_user_profile_snapshot(db: AsyncSession, target_user: Users) -> dict[str, object]:
    user_id = target_user.id

    achievements_stmt = (
        select(Achievement)
        .options(selectinload(Achievement.user))
        .filter(Achievement.user_id == user_id, Achievement.status != AchievementStatus.ARCHIVED)
        .order_by(Achievement.created_at.desc())
    )
    achievements = (await db.execute(achievements_stmt)).scalars().all()

    history_stmt = (
        select(SeasonResult)
        .filter(SeasonResult.user_id == user_id)
        .order_by(SeasonResult.created_at.desc())
    )
    season_history = (await db.execute(history_stmt)).scalars().all()

    total_docs = len(achievements)
    rank = None
    total_points = calculate_gpa_bonus(target_user.session_gpa)
    gpa_bonus = calculate_gpa_bonus(target_user.session_gpa)

    if target_user.role == UserRole.STUDENT and target_user.status == UserStatus.ACTIVE:
        achievement_points = func.coalesce(func.sum(Achievement.points), 0)
        total_points_expr = (
            achievement_points + aggregated_gpa_bonus_expr(Users.session_gpa)
        ).label('total_points')
        leaderboard_stmt = (
            select(Users.id, total_points_expr)
            .outerjoin(Achievement, (Users.id == Achievement.user_id) & (Achievement.status == AchievementStatus.APPROVED))
            .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
            .group_by(Users.id)
            .order_by(desc('total_points'))
        )
        results = (await db.execute(leaderboard_stmt)).all()
        for index, row in enumerate(results, 1):
            uid, points = row
            if uid == user_id:
                rank = index
                total_points = int(points or 0)
                break

    chart_query = (
        select(
            func.date_trunc('month', Achievement.created_at).label('bucket'),
            func.count().label('count'),
            func.coalesce(func.sum(Achievement.points), 0).label('points'),
        )
        .filter(Achievement.user_id == user_id, Achievement.status == AchievementStatus.APPROVED)
        .group_by(literal_column('bucket'))
        .order_by(literal_column('bucket'))
    )
    chart_rows = (await db.execute(chart_query)).all()

    return {
        'achievements': achievements,
        'season_history': season_history,
        'total_docs': total_docs,
        'rank': rank,
        'total_points': int(total_points or 0),
        'gpa_bonus': int(gpa_bonus or 0),
        'chart_rows': chart_rows,
    }


def _resolve_education_level(value: str | None):
    if not value or value == 'all':
        return None

    for item in EducationLevel:
        if value in {item.value, item.name}:
            return item

    raise HTTPException(status_code=400, detail='Unknown education level')


def _assert_role_change_allowed(current_user, target_user, new_role: UserRole):
    if current_user.id == target_user.id:
        raise HTTPException(status_code=400, detail='You cannot change your own role.')

    if current_user.role == UserRole.SUPER_ADMIN:
        return

    current_level = ROLE_HIERARCHY.get(current_user.role, 0)
    target_level = ROLE_HIERARCHY.get(target_user.role, 0)
    new_level = ROLE_HIERARCHY.get(new_role, 0)

    if target_level >= current_level or new_level >= current_level:
        raise HTTPException(status_code=403, detail='Insufficient permissions for this role change.')


async def _get_target_user_or_404(db: AsyncSession, user_id: int):
    target_user = await db.get(Users, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail='User not found')
    return target_user


@router.get('')
@router.get('/')
async def list_users(
    page: int = Query(default=1, ge=1, le=1000),
    query: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    education_level: str | None = Query(default=None),
    course: str | None = Query(default=None),
    roles: list[str] | None = Query(default=None),
    statuses: list[str] | None = Query(default=None),
    education_levels: list[str] | None = Query(default=None),
    courses: list[str] | None = Query(default=None),
    sort_by: str = Query(default='newest'),
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    limit = 10
    offset = (page - 1) * limit
    course_int = int(course) if course and str(course).isdigit() else None
    course_ints = [int(c) for c in (courses or []) if str(c).isdigit()]

    stmt = select(Users).filter(Users.status != UserStatus.REJECTED)

    stmt = _apply_moderator_user_scope(stmt, current_user)

    if query:
        like_term = f"%{escape_like(query)}%"
        stmt = stmt.filter(
            or_(
                Users.first_name.ilike(like_term),
                Users.last_name.ilike(like_term),
                Users.email.ilike(like_term),
                Users.phone_number.ilike(like_term),
                (Users.first_name + ' ' + Users.last_name).ilike(like_term),
                (Users.last_name + ' ' + Users.first_name).ilike(like_term),
            )
        )

    # Multi-select filters use IN (OR within a dimension); dimensions combine with AND.
    if roles:
        stmt = stmt.filter(Users.role.in_(roles))
    elif role and role != 'all':
        stmt = stmt.filter(Users.role == role)
    if statuses:
        stmt = stmt.filter(Users.status.in_(statuses))
    elif status and status != 'all':
        stmt = stmt.filter(Users.status == status)
    if education_levels:
        stmt = stmt.filter(Users.education_level.in_(education_levels))
    elif education_level and education_level != 'all':
        stmt = stmt.filter(Users.education_level == education_level)
    if course_ints:
        stmt = stmt.filter(Users.course.in_(course_ints))
    elif course_int and course_int != 0:
        stmt = stmt.filter(Users.course == course_int)

    if sort_by == 'oldest':
        stmt = stmt.order_by(Users.created_at.asc())
    elif sort_by in {'first_name_asc', 'name_asc'}:
        stmt = stmt.order_by(Users.first_name.asc(), Users.last_name.asc(), Users.created_at.desc())
    elif sort_by in {'first_name_desc', 'name_desc'}:
        stmt = stmt.order_by(Users.first_name.desc(), Users.last_name.desc(), Users.created_at.desc())
    elif sort_by == 'last_name_asc':
        stmt = stmt.order_by(Users.last_name.asc(), Users.first_name.asc(), Users.created_at.desc())
    elif sort_by == 'last_name_desc':
        stmt = stmt.order_by(Users.last_name.desc(), Users.first_name.desc(), Users.created_at.desc())
    else:
        stmt = stmt.order_by(Users.created_at.desc())

    total_items = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    users = (await db.execute(stmt.offset(offset).limit(limit))).scalars().all()

    return {
        'users': [serialize_user(item) for item in users],
        'page': page,
        'total_pages': max(1, math.ceil(total_items / limit)),
        'roles': [item.value for item in UserRole],
        'statuses': [item.value for item in VISIBLE_USER_STATUSES],
        'education_levels': AVAILABLE_EDUCATION_LEVELS,
        'course_mapping': COURSE_MAPPING,
        'group_mapping': GROUP_MAPPING,
    }


@router.get('/search')
async def search_users(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    like_term = f"%{escape_like(q)}%"
    stmt = (
        select(Users)
        .filter(
            Users.status != UserStatus.REJECTED,
            or_(
                Users.first_name.ilike(like_term),
                Users.last_name.ilike(like_term),
                Users.email.ilike(like_term),
                Users.phone_number.ilike(like_term),
                (Users.first_name + ' ' + Users.last_name).ilike(like_term),
                (Users.last_name + ' ' + Users.first_name).ilike(like_term),
            ),
        )
        .limit(limit)
    )

    stmt = _apply_moderator_user_scope(stmt, current_user)

    users = (await db.execute(stmt)).scalars().all()
    return [
        {
            'id': user.id,
            'value': user.email,
            'text': f'{user.first_name} {user.last_name} ({user.email})',
        }
        for user in users
    ]


@router.post('/smart-search')
async def smart_search_users(
    payload: SmartSearchPayload,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    description = payload.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail='Опишите критерии поиска.')

    stmt = select(Users).filter(
        Users.status != UserStatus.REJECTED,
        Users.role == UserRole.STUDENT,
    )
    stmt = _apply_moderator_user_scope(stmt, current_user)

    if payload.education_levels:
        stmt = stmt.filter(Users.education_level.in_(payload.education_levels))
    course_ints = [int(c) for c in (payload.courses or []) if str(c).isdigit()]
    if course_ints:
        stmt = stmt.filter(Users.course.in_(course_ints))
    if payload.statuses:
        stmt = stmt.filter(Users.status.in_(payload.statuses))

    stmt = stmt.order_by(Users.created_at.desc())

    service = SmartSearchService(db)
    matched_ids = await service.search(stmt, description)

    if matched_ids is None:
        raise HTTPException(
            status_code=503,
            detail='AI-поиск временно недоступен — сервис локальной LLM не отвечает.',
        )

    users_by_id = {}
    if matched_ids:
        found = (await db.execute(select(Users).filter(Users.id.in_(matched_ids)))).scalars().all()
        users_by_id = {user.id: user for user in found}

    ordered_users = [users_by_id[uid] for uid in matched_ids if uid in users_by_id]

    return {
        'users': [serialize_user(item) for item in ordered_users],
        'page': 1,
        'total_pages': 1,
        'roles': [item.value for item in UserRole],
        'statuses': [item.value for item in VISIBLE_USER_STATUSES],
        'education_levels': AVAILABLE_EDUCATION_LEVELS,
        'course_mapping': COURSE_MAPPING,
        'group_mapping': GROUP_MAPPING,
    }


@router.get('/{user_id}')
async def get_user_detail(
    user_id: int,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if not _can_view_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')
    snapshot = await _load_user_profile_snapshot(db, target_user)
    achievements = snapshot['achievements']
    season_history = snapshot['season_history']
    total_docs = snapshot['total_docs']
    rank = snapshot['rank']
    total_points = snapshot['total_points']
    gpa_bonus = snapshot['gpa_bonus']
    chart_rows = snapshot['chart_rows']

    return {
        'user': serialize_user(target_user),
        'achievements': [serialize_achievement(item) for item in achievements],
        'season_history': [_serialize_season_result(item) for item in season_history],
        'total_docs': total_docs,
        'rank': rank,
        'total_points': int(total_points or 0),
        'gpa_bonus': int(gpa_bonus or 0),
        'chart_labels': [row.bucket.strftime('%m.%Y') for row in chart_rows] if chart_rows else [],
        'chart_counts': [int(row.count or 0) for row in chart_rows] if chart_rows else [],
        'chart_points': [int(row.points or 0) for row in chart_rows] if chart_rows else [],
        'roles': [item.value for item in UserRole],
        'education_levels': AVAILABLE_EDUCATION_LEVELS,
        'course_mapping': COURSE_MAPPING,
        'group_mapping': GROUP_MAPPING,
    }


@router.post('/{user_id}/role')
async def update_user_role(
    user_id: int,
    payload: UpdateRolePayload,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if not _can_access_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')

    _assert_role_change_allowed(current_user, target_user, payload.role)

    update_data: dict[str, object | None] = {'role': payload.role}
    if payload.role == UserRole.MODERATOR:
        update_data['education_level'] = _resolve_education_level(payload.education_level)
        update_data['moderator_courses'] = ','.join(
            str(course) for course in sorted(set(payload.moderator_courses or [])) if course in {1, 2}
        ) or None
        valid_groups = {
            group
            for groups_by_course in GROUP_MAPPING.values()
            for groups in groups_by_course.values()
            for group in groups
        }
        update_data['moderator_groups'] = ','.join(
            group for group in (payload.moderator_groups or []) if group in valid_groups
        ) or None
    elif payload.role == UserRole.SUPER_ADMIN:
        update_data['education_level'] = None
        update_data['moderator_courses'] = None
        update_data['moderator_groups'] = None
    else:
        update_data['moderator_courses'] = None
        update_data['moderator_groups'] = None

    # Super admin promoting a guest to any real role — activate immediately
    # regardless of email verification status
    if (
        current_user.role == UserRole.SUPER_ADMIN
        and target_user.role == UserRole.GUEST
        and payload.role != UserRole.GUEST
    ):
        update_data['is_active'] = True
        update_data['status'] = UserStatus.ACTIVE

    repository = UserRepository(db)
    updated_user = await repository.update(user_id, update_data)
    return {'success': True, 'user': serialize_user(updated_user)}


@router.delete('/{user_id}')
async def delete_user(
    user_id: int,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if current_user.id == target_user.id:
        raise HTTPException(status_code=400, detail='You cannot delete yourself.')
    if not _can_access_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')

    if current_user.role != UserRole.SUPER_ADMIN:
        current_level = ROLE_HIERARCHY.get(current_user.role, 0)
        target_level = ROLE_HIERARCHY.get(target_user.role, 0)
        if target_level >= current_level:
            raise HTTPException(status_code=403, detail='Insufficient permissions for deletion.')

    target_user.status = UserStatus.DELETED
    target_user.role = UserRole.GUEST
    target_user.is_active = True
    target_user.reviewed_by_id = None
    target_user.session_version = int(target_user.session_version or 0) + 1
    target_user.api_access_version = int(target_user.api_access_version or 0) + 1
    target_user.api_refresh_version = int(target_user.api_refresh_version or 0) + 1
    await db.commit()
    await invalidate_scoreboard_caches()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.post('/{user_id}/restore')
async def restore_user(
    user_id: int,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if not _can_access_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')

    if current_user.role != UserRole.SUPER_ADMIN:
        current_level = ROLE_HIERARCHY.get(current_user.role, 0)
        target_level = ROLE_HIERARCHY.get(target_user.role, 0)
        if target_level >= current_level:
            raise HTTPException(status_code=403, detail='Insufficient permissions for restoration.')

    if target_user.status == UserStatus.DELETED and target_user.role == UserRole.GUEST:
        target_user.role = UserRole.STUDENT

    target_user.status = UserStatus.PENDING if target_user.role == UserRole.GUEST else UserStatus.ACTIVE
    target_user.is_active = True
    target_user.reviewed_by_id = None
    target_user.session_version = int(target_user.session_version or 0) + 1
    target_user.api_access_version = int(target_user.api_access_version or 0) + 1
    target_user.api_refresh_version = int(target_user.api_refresh_version or 0) + 1
    await db.commit()
    await invalidate_scoreboard_caches()
    await db.refresh(target_user)
    return {'success': True, 'user': serialize_user(target_user)}


@router.get('/{user_id}/generate-resume')
async def get_resume_state(
    user_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if current_user.id != user_id:
        if not current_user.is_staff or not _can_access_target(current_user, target_user):
            raise HTTPException(status_code=403, detail='Access denied')

    service = ResumeService(db)
    check = await service.can_generate(user_id)
    return {
        'resume': target_user.resume_text or '',
        'can_generate': bool(check['allowed']),
        'reason': check.get('reason'),
    }


@router.post('/{user_id}/generate-resume')
async def generate_resume(
    user_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if current_user.id != user_id:
        if not current_user.is_staff or not _can_access_target(current_user, target_user):
            raise HTTPException(status_code=403, detail='Access denied')

    service = ResumeService(db)
    result = await service.generate_resume(user_id, force_regenerate=True, bypass_check=current_user.is_staff)
    if not result['success']:
        status_code = int(result.get('status_code') or 429)
        detail = result.get('error')
        if status_code == 429 and not detail:
            check = await service.can_generate(user_id)
            detail = check.get('reason')
        raise HTTPException(
            status_code=status_code,
            detail=detail or 'Resume generation is unavailable.',
        )

    refreshed_user = await _get_target_user_or_404(db, user_id)
    check = await service.can_generate(user_id)
    return {
        'resume': result['resume'],
        'can_generate': bool(check['allowed']),
        'reason': check.get('reason'),
        'user': serialize_user(refreshed_user),
    }


@router.post('/{user_id}/set-gpa')
async def set_gpa(
    user_id: int,
    payload: SetGpaPayload,
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if not _can_access_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')

    try:
        gpa_value = float(str(payload.gpa).replace(',', '.'))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid GPA value.') from exc

    if gpa_value < 2.0 or gpa_value > 5.0:
        raise HTTPException(status_code=400, detail='GPA must be between 2.0 and 5.0.')

    target_user.session_gpa = f'{gpa_value:.1f}'
    await db.commit()
    await invalidate_scoreboard_caches()
    await db.refresh(target_user)

    return {
        'success': True,
        'gpa': target_user.session_gpa,
        'bonus': calculate_gpa_bonus(target_user.session_gpa),
        'user': serialize_user(target_user),
    }


@router.post('/{user_id}/support-message')
async def create_support_message_for_user(
    user_id: int,
    subject: str = Form(default='Сообщение от модератора'),
    text: str = Form(...),
    file: UploadFile | None = File(default=None),
    session_duration: str = Form(default='month'),
    current_user=Depends(_check_admin_rights),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if not _can_access_target(current_user, target_user):
        raise HTTPException(status_code=403, detail='Access denied')
    if current_user.id == target_user.id:
        raise HTTPException(status_code=400, detail='Нельзя создать обращение самому себе.')

    try:
        ticket = await service.create_ticket_from_moderator(
            user_id=target_user.id,
            moderator_id=current_user.id,
            subject=subject,
            text=text,
            file=file if file and file.filename else None,
            session_duration=session_duration,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or 'Не удалось отправить сообщение пользователю.') from exc

    notification = make_notification(
        user_id=target_user.id,
        title='Новое сообщение от модератора',
        message=f'Модератор написал вам в обращении «{ticket.subject}».',
        link=f'/sirius.achievements/app/support/{ticket.id}',
    )
    db.add(notification)
    await db.commit()
    await ws_manager.send_to_user(
        target_user.id,
        {'type': 'notification', 'notification': serialize_notification(notification)},
    )

    return {'success': True, 'ticket_id': ticket.id}


@router.get('/{user_id}/export-pdf')
async def export_user_pdf(
    user_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    target_user = await _get_target_user_or_404(db, user_id)
    if current_user.id != user_id:
        if not current_user.is_staff or not _can_view_target(current_user, target_user):
            raise HTTPException(status_code=403, detail='Access denied')
    snapshot = await _load_user_profile_snapshot(db, target_user)
    achievements = snapshot['achievements']
    season_history = snapshot['season_history']
    total_docs = snapshot['total_docs']
    rank = snapshot['rank']
    total_points = snapshot['total_points']
    gpa_bonus = snapshot['gpa_bonus']

    document = fitz.open()
    page_width = 595
    page_height = 842
    left = 48
    right = page_width - 48
    top = 54
    bottom = page_height - 48
    font_path = _resolve_pdf_font_path()
    pdf_font_name = PDF_FONT_NAME if font_path else 'helv'
    page = document.new_page(width=page_width, height=page_height)
    y = top

    def apply_page_font():
        if font_path:
            page.insert_font(fontname=PDF_FONT_NAME, fontfile=str(font_path))

    apply_page_font()

    def new_page():
        nonlocal page, y
        page = document.new_page(width=page_width, height=page_height)
        y = top
        apply_page_font()

    def ensure_space(min_height: int = 20):
        nonlocal y
        if y + min_height > bottom:
            new_page()

    def write_wrapped(text: str, size: int = 11, color=(0.2, 0.2, 0.2), width: int = 88, gap: int = 5):
        nonlocal y
        value = (text or '').strip()
        if not value:
            y += gap
            return

        paragraphs = value.splitlines() or ['']
        for paragraph in paragraphs:
            lines = wrap(paragraph.strip() or ' ', width=width, break_long_words=False, break_on_hyphens=False) or ['']
            for line in lines:
                ensure_space(size + gap)
                page.insert_text((left, y), line, fontsize=size, fontname=pdf_font_name, color=PDF_TEXT_COLOR)
                y += size + gap

    def write_heading(text: str):
        nonlocal y
        ensure_space(26)
        page.draw_line((left, y - 4), (right, y - 4), color=(0.88, 0.9, 0.96), width=1)
        page.insert_text((left, y + 8), text, fontsize=14, fontname=pdf_font_name, color=PDF_TEXT_COLOR)
        y += 26

    avatar_path = getattr(target_user, 'avatar_path', None)
    if avatar_path:
        try:
            resolved_avatar = resolve_static_path(avatar_path)
            if resolved_avatar.exists() and resolved_avatar.is_file():
                page.insert_image(fitz.Rect(right - 86, top - 6, right, top + 80), filename=str(resolved_avatar))
        except ValueError:
            pass

    write_wrapped('Sirius.Achievements', size=18, color=(0.35, 0.3, 0.92), width=40, gap=7)
    write_wrapped('Экспорт профиля пользователя', size=13, color=(0.24, 0.24, 0.24), width=52, gap=8)
    write_wrapped(
        f'Сформировано: {_format_ru_datetime(getattr(target_user, "updated_at", None) or getattr(target_user, "created_at", None))}',
        size=9,
        color=(0.45, 0.45, 0.45),
        width=90,
        gap=6,
    )
    y += 6

    write_heading('Основная информация')
    write_wrapped(f'ФИО: {target_user.first_name} {target_user.last_name}', width=76)
    write_wrapped(f'Email: {target_user.email}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Роль: {_user_role_label(target_user.role)}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Статус: {_user_status_label(target_user.status)}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Уровень обучения: {target_user.education_level.value if target_user.education_level else "—"}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Курс: {target_user.course or "—"} | Группа: {target_user.study_group or "—"}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Телефон: {target_user.phone_number or "Не указан"}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Средний балл сессии: {target_user.session_gpa or "—"} | GPA-бонус: {gpa_bonus}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Дата регистрации: {_format_ru_date(target_user.created_at)}', size=10, color=(0.35, 0.35, 0.35), width=90)

    write_heading('Сводка профиля')
    write_wrapped(f'Документов в профиле: {total_docs}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Текущее место в рейтинге: #{rank}' if rank else 'Текущее место в рейтинге: —', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Суммарные баллы: {total_points}', size=10, color=(0.35, 0.35, 0.35), width=90)
    write_wrapped(f'Архив сезонов: {len(season_history)} записей', size=10, color=(0.35, 0.35, 0.35), width=90)

    if target_user.resume_text:
        write_heading('AI-сводка профиля')
        write_wrapped(target_user.resume_text, size=9, color=(0.28, 0.28, 0.28), width=96, gap=4)

    if season_history:
        write_heading('Архив сезонов')
        for index, item in enumerate(season_history, 1):
            write_wrapped(
                f'{index}. {item.season_name}: место #{item.rank}, баллы {int(item.points or 0)}, дата {_format_ru_date(item.created_at)}',
                size=9,
                color=(0.3, 0.3, 0.3),
                width=96,
                gap=4,
            )

    write_heading('Документы профиля')
    if achievements:
        for index, item in enumerate(achievements, 1):
            write_wrapped(f'{index}. {item.title or "Без названия"}', size=11, color=(0.18, 0.18, 0.18), width=74, gap=4)
            write_wrapped(
                f'Статус: {_achievement_status_label(item.status)} | Категория: {item.category.value if item.category else "—"} | Уровень: {item.level.value if item.level else "—"} | Результат: {item.result.value if item.result else "—"} | Баллы: {int(item.points or 0)}',
                size=9,
                color=(0.35, 0.35, 0.35),
                width=102,
                gap=4,
            )
            write_wrapped(f'Дата загрузки: {_format_ru_datetime(item.created_at)}', size=9, color=(0.35, 0.35, 0.35), width=102, gap=4)
            if item.description:
                write_wrapped(f'Описание: {item.description}', size=9, color=(0.35, 0.35, 0.35), width=96, gap=4)
            if item.rejection_reason:
                write_wrapped(f'Комментарий модератора: {item.rejection_reason}', size=9, color=(0.72, 0.24, 0.24), width=96, gap=4)
            y += 4
    else:
        write_wrapped('Документы пока отсутствуют.', size=10, color=(0.45, 0.45, 0.45), width=90, gap=5)

    pdf_bytes = document.tobytes(deflate=True)
    document.close()
    filename = f'profile_{target_user.id}.pdf'
    return Response(
        content=pdf_bytes,
        media_type='application/pdf',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )
