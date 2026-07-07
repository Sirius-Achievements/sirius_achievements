from __future__ import annotations

import csv
import io
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementCategory, AchievementStatus, UserRole, UserStatus
from app.models.season_result import SeasonResult
from app.models.user import Users
from app.utils.points import aggregated_gpa_bonus_expr
from app.utils.education import AVAILABLE_EDUCATION_LEVELS, COURSE_MAPPING, GROUP_MAPPING

from app.utils.cache import cache_get_json, cache_set_json

from .serializers import serialize_user, serialize_user_public

router = APIRouter(prefix='/api/v1/leaderboard', tags=['api.v1.leaderboard'])

# The ranked aggregation (GROUP BY over achievements) is identical for everyone
# in the same scope+filters, so cache it briefly in Redis. Per-viewer bits
# (is_me / my_rank / own full profile) are layered on top per request. A short
# TTL keeps it fresh enough for a leaderboard while collapsing the repeated
# aggregate under concurrent load. Fail-open: any Redis error falls back to DB.
LEADERBOARD_CACHE_TTL = int(os.getenv('LEADERBOARD_CACHE_TTL', 30))


def _scoped_education_level(user: Users, requested_level: str | None):
    if not user.is_staff:
        return user.education_level_value or 'all'
    if user.role == UserRole.MODERATOR and user.education_level:
        return user.education_level_value
    return requested_level or 'all'


def _scoped_course(user: Users, requested_course: int | None):
    if not user.is_staff:
        return user.course if user.course else 0
    if requested_course is None:
        return 0
    return requested_course


def _apply_student_scope(stmt, user: Users, education_level: str | None, course: int | None, group: str | None = None):
    if user.role == UserRole.MODERATOR and user.education_level:
        stmt = stmt.filter(Users.education_level == user.education_level)
        if user.moderator_courses:
            courses = [int(item) for item in user.moderator_courses.split(',') if item.isdigit()]
            if courses:
                stmt = stmt.filter(Users.course.in_(courses))
        if user.moderator_groups:
            groups = [item.strip() for item in user.moderator_groups.split(',') if item.strip()]
            if groups:
                stmt = stmt.filter(Users.study_group.in_(groups))
    elif education_level and education_level != 'all':
        stmt = stmt.filter(Users.education_level == education_level)

    if course and course != 0:
        stmt = stmt.filter(Users.course == course)

    if group and group != 'all':
        stmt = stmt.filter(Users.study_group == group)

    return stmt


def _build_query_params(education_level: str | None, course: int | None, categories: list[str] | None, group: str | None, category_logic: str = 'or'):
    params: list[tuple[str, str | int]] = []
    if education_level and education_level != 'all':
        params.append(('education_level', education_level))
    if course and course != 0:
        params.append(('course', course))
    for cat in categories or []:
        params.append(('categories', cat))
    if categories and len(categories) > 1 and category_logic == 'and':
        params.append(('category_logic', 'and'))
    if group and group != 'all':
        params.append(('group', group))
    return params


def _scope_signature(user: Users, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str) -> str:
    """Key the cached ranked list by everything that changes the query rows."""
    cats = ','.join(sorted(categories)) if categories else ''
    logic = category_logic if (categories and len(categories) > 1) else 'or'
    if user.role == UserRole.MODERATOR and user.education_level:
        zone = f'mod:{user.education_level_value}:{user.moderator_courses or ""}:{user.moderator_groups or ""}'
    else:
        zone = f'lvl:{education_level or "all"}'
    return f'lb:{zone}|c={course or 0}|g={group or "all"}|cat={cats}|logic={logic}'


async def _compute_ranked_base(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str, full_users: bool = False) -> list[dict]:
    """Run the ranked aggregation and serialize rows (public, or full for export)."""
    achievement_filter = Achievement.status == AchievementStatus.APPROVED
    if categories:
        achievement_filter = achievement_filter & (Achievement.category.in_(categories))

    include_gpa_bonus = not categories
    achievement_points = func.coalesce(func.sum(Achievement.points), 0)
    total_points_expr = (
        achievement_points + aggregated_gpa_bonus_expr(Users.session_gpa, include_bonus=include_gpa_bonus)
    ).label('total_points')

    stmt = (
        select(
            Users,
            total_points_expr,
            func.count(Achievement.id).label('achievements_count'),
        )
        .outerjoin(Achievement, (Users.id == Achievement.user_id) & achievement_filter)
        .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
    )
    stmt = _apply_student_scope(stmt, user, education_level, course, group)
    stmt = stmt.group_by(Users.id)
    # When directions are selected, rank only students who have matching documents:
    # OR = at least one selected direction, AND = every selected direction.
    if categories:
        min_distinct = len(categories) if (category_logic == 'and' and len(categories) > 1) else 1
        stmt = stmt.having(func.count(func.distinct(Achievement.category)) >= min_distinct)
    stmt = stmt.order_by(desc('total_points'), desc('achievements_count'))

    result = await db.execute(stmt)
    rows = result.all()

    base = []
    for index, (student, points, achievements_count) in enumerate(rows, 1):
        view = serialize_user(student) if full_users else serialize_user_public(student)
        base.append({
            'rank': index,
            'user': view,
            'total_points': int(points or 0),
            'achievements_count': int(achievements_count or 0),
        })
    return base


async def _cached_ranked_base(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str) -> list[dict]:
    key = _scope_signature(user, education_level, course, categories, group, category_logic)
    cached = await cache_get_json(key)
    if cached is not None:
        return cached
    base = await _compute_ranked_base(user, db, education_level, course, categories, group, category_logic)
    await cache_set_json(key, base, LEADERBOARD_CACHE_TTL)
    return base


async def _build_leaderboard_payload(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str] | None, group: str | None, category_logic: str = 'or', full_users: bool = False):
    categories = [c for c in (categories or []) if c and c != 'all']

    # Staff export serializes every row fully and is rare — skip the cache.
    if full_users:
        base = await _compute_ranked_base(user, db, education_level, course, categories, group, category_logic, full_users=True)
    else:
        base = await _cached_ranked_base(user, db, education_level, course, categories, group, category_logic)

    my_rank = 0
    my_points = 0
    leaderboard = []
    for row in base:
        is_me = row['user'].get('id') == user.id
        if is_me:
            my_rank = row['rank']
            my_points = row['total_points']
        # The cached base serializes peers as public; swap the viewer's own row
        # for the full serialization so they still see their private fields.
        peer_view = serialize_user(user) if (is_me and not full_users) else row['user']
        leaderboard.append(
            {
                'rank': row['rank'],
                'user': peer_view,
                'total_points': row['total_points'],
                'achievements_count': row['achievements_count'],
                'is_me': is_me,
            }
        )

    flat_group_mapping = {
        level: [group for groups in by_course.values() for group in groups]
        for level, by_course in GROUP_MAPPING.items()
    }

    params = _build_query_params(education_level, course, categories, group, category_logic)
    export_query = urlencode(params)

    return {
        'leaderboard': leaderboard,
        'my_rank': my_rank,
        'my_points': my_points,
        'current_education_level': education_level,
        'current_course': course,
        'current_category': categories[0] if len(categories) == 1 else 'all',
        'current_categories': categories,
        'current_category_logic': category_logic if len(categories) > 1 else 'or',
        'current_group': group or 'all',
        'categories': [item.value if hasattr(item, 'value') else str(item) for item in AchievementCategory],
        'education_levels': AVAILABLE_EDUCATION_LEVELS,
        'course_mapping': COURSE_MAPPING,
        'group_mapping': flat_group_mapping,
        'course_group_mapping': GROUP_MAPPING,
        'can_export': bool(user.is_staff),
        'can_end_season': bool(user.role == UserRole.SUPER_ADMIN),
        'export_url': f"/api/v1/leaderboard/export?{export_query}" if export_query else '/api/v1/leaderboard/export',
    }


@router.get('')
@router.get('/')
async def leaderboard(
    education_level: str | None = Query(None),
    course: str | None = Query(None),
    category: str | None = Query(None),
    categories: list[str] | None = Query(None),
    category_logic: str = Query('or'),
    group: str | None = Query(None),
    scope: str | None = Query(None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.status == UserStatus.DELETED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Аккаунт удалён. Доступна только поддержка.')

    selected = categories if categories else ([category] if category else [])
    # scope=global lets a student break out of their own stream and see everyone.
    if scope == 'global' and not current_user.is_staff:
        return await _build_leaderboard_payload(current_user, db, 'all', 0, selected, 'all', category_logic)

    course_int = int(course) if course and course.isdigit() else None
    scoped_education_level = _scoped_education_level(current_user, education_level)
    scoped_course = _scoped_course(current_user, course_int)
    scoped_group = group or 'all'
    return await _build_leaderboard_payload(current_user, db, scoped_education_level, scoped_course, selected, scoped_group, category_logic)


@router.get('/export')
async def export_leaderboard(
    education_level: str | None = Query(None),
    course: str | None = Query(None),
    category: str | None = Query(None),
    categories: list[str] | None = Query(None),
    category_logic: str = Query('or'),
    group: str | None = Query(None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.is_staff:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Экспорт доступен только сотрудникам.')

    course_int = int(course) if course and course.isdigit() else None
    scoped_education_level = _scoped_education_level(current_user, education_level)
    scoped_course = _scoped_course(current_user, course_int)
    scoped_group = group or 'all'
    selected = categories if categories else ([category] if category else [])
    payload = await _build_leaderboard_payload(current_user, db, scoped_education_level, scoped_course, selected, scoped_group, category_logic, full_users=True)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow(['Место', 'Имя', 'Фамилия', 'Email', 'Уровень обучения', 'Курс', 'Группа', 'Сумма баллов', 'Документов'])

    for row in payload['leaderboard']:
        user = row['user']
        writer.writerow([
            row['rank'],
            user.get('first_name') or '',
            user.get('last_name') or '',
            user.get('email') or '',
            user.get('education_level') or '',
            user.get('course') or '',
            user.get('study_group') or '',
            row['total_points'],
            row['achievements_count'],
        ])

    output.seek(0)
    return Response(
        content='\ufeff' + output.getvalue(),
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename=leaderboard_export.csv'},
    )


@router.post('/end-season')
async def end_season(
    season_name: str = Form(...),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Только супер-админ может завершать сезон.')

    achievement_points = func.coalesce(func.sum(Achievement.points), 0)
    total_points_expr = (
        achievement_points + aggregated_gpa_bonus_expr(Users.session_gpa)
    ).label('total_points')

    stmt = (
        select(Users.id, total_points_expr)
        .outerjoin(Achievement, (Users.id == Achievement.user_id) & (Achievement.status == AchievementStatus.APPROVED))
        .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
        .group_by(Users.id)
        .order_by(desc('total_points'))
    )
    rows = (await db.execute(stmt)).all()

    for rank, (user_id, points) in enumerate(rows, 1):
        if points and int(points) > 0:
            db.add(SeasonResult(user_id=user_id, season_name=season_name, points=int(points), rank=rank))

    await db.execute(
        update(Achievement)
        .where(Achievement.status == AchievementStatus.APPROVED)
        .values(status=AchievementStatus.ARCHIVED)
    )
    await db.execute(
        update(Users)
        .where(Users.role == UserRole.STUDENT)
        .values(session_gpa=None)
    )
    await db.commit()

    return {'success': True}

