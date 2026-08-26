from __future__ import annotations

import csv
import io
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import and_, case, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementCategory, AchievementStatus, UserRole, UserStatus
from app.models.season import Season
from app.models.season_result import SeasonResult
from app.models.user import Users
from app.utils.points import aggregated_gpa_bonus_expr, calculate_gpa_bonus
from app.utils.education import AVAILABLE_EDUCATION_LEVELS, COURSE_MAPPING, GROUP_MAPPING

from app.utils.cache import cache_get_json, cache_set_json, invalidate_scoreboard_caches

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


def _build_query_params(education_level: str | None, course: int | None, categories: list[str] | None, group: str | None, category_logic: str = 'or', season: str = 'current'):
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
    if season != 'current':
        params.append(('season', season))
    return params


def _scope_signature(user: Users, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str, season: str) -> str:
    """Key the cached ranked list by everything that changes the query rows."""
    cats = ','.join(sorted(categories)) if categories else ''
    logic = category_logic if (categories and len(categories) > 1) else 'or'
    if user.role == UserRole.MODERATOR and user.education_level:
        zone = f'mod:{user.education_level_value}:{user.moderator_courses or ""}:{user.moderator_groups or ""}'
    else:
        zone = f'lvl:{education_level or "all"}'
    return f'lb:{zone}|c={course or 0}|g={group or "all"}|cat={cats}|logic={logic}|season={season}'


def _approved_achievement_condition(season: str):
    current = and_(
        Achievement.status == AchievementStatus.APPROVED,
        Achievement.archived_season.is_(None),
        Achievement.eligible_for_ranking.is_(True),
    )
    archived = and_(
        Achievement.archived_season.is_not(None),
        Achievement.eligible_for_ranking.is_(True),
        or_(
            Achievement.status == AchievementStatus.APPROVED,
            and_(
                Achievement.status == AchievementStatus.ARCHIVED,
                or_(
                    Achievement.archived_from_status == AchievementStatus.APPROVED.value,
                    Achievement.archived_from_status.is_(None),
                ),
            ),
        ),
    )
    if season == 'global':
        return or_(current, archived)
    if season == 'current':
        return current
    return and_(archived, Achievement.archived_season == season)


async def _compute_ranked_base(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str, season: str = 'current', full_users: bool = False) -> list[dict]:
    """Run the ranked aggregation and serialize rows (public, or full for export)."""
    achievement_filter = _approved_achievement_condition(season)
    if categories:
        achievement_filter = achievement_filter & (Achievement.category.in_(categories))

    include_gpa_bonus = not categories and season == 'current'
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

    student_ids = [student.id for student, _points, _count in rows]
    breakdown_by_user: dict[int, list[dict]] = {student_id: [] for student_id in student_ids}
    if student_ids:
        breakdown_stmt = (
            select(
                Achievement.user_id,
                Achievement.category,
                func.coalesce(func.sum(Achievement.points), 0).label('points'),
            )
            .join(Users, Users.id == Achievement.user_id)
            .filter(
                Achievement.user_id.in_(student_ids),
                _approved_achievement_condition(season),
                Users.role == UserRole.STUDENT,
                Users.status == UserStatus.ACTIVE,
            )
        )
        if categories:
            breakdown_stmt = breakdown_stmt.filter(Achievement.category.in_(categories))
        breakdown_stmt = breakdown_stmt.group_by(Achievement.user_id, Achievement.category)
        for user_id, category, points in (await db.execute(breakdown_stmt)).all():
            category_label = category.value if hasattr(category, 'value') else str(category)
            breakdown_by_user[user_id].append({'label': category_label, 'points': int(points or 0)})

    previous_by_user: dict[int, SeasonResult] = {}
    if student_ids and not categories and season == 'current':
        previous_stmt = (
            select(SeasonResult)
            .filter(SeasonResult.user_id.in_(student_ids))
            .order_by(SeasonResult.created_at.desc(), SeasonResult.id.desc())
        )
        for previous in (await db.execute(previous_stmt)).scalars().all():
            previous_by_user.setdefault(previous.user_id, previous)

    base = []
    for index, (student, points, achievements_count) in enumerate(rows, 1):
        view = serialize_user(student) if full_users else serialize_user_public(student)
        breakdown = list(breakdown_by_user.get(student.id, []))
        if include_gpa_bonus:
            gpa_bonus = calculate_gpa_bonus(student.session_gpa)
            if gpa_bonus:
                breakdown.append({'label': 'Бонус за средний балл', 'points': gpa_bonus})
        breakdown.sort(key=lambda item: item['points'], reverse=True)
        previous = previous_by_user.get(student.id)
        base.append({
            'rank': index,
            'user': view,
            'total_points': int(points or 0),
            'achievements_count': int(achievements_count or 0),
            'points_breakdown': breakdown,
            'previous_rank': previous.rank if previous else None,
            'previous_season': previous.season_name if previous else None,
        })
    return base


async def _cached_ranked_base(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str], group: str | None, category_logic: str, season: str) -> list[dict]:
    key = _scope_signature(user, education_level, course, categories, group, category_logic, season)
    cached = await cache_get_json(key)
    if cached is not None:
        return cached
    base = await _compute_ranked_base(user, db, education_level, course, categories, group, category_logic, season)
    await cache_set_json(key, base, LEADERBOARD_CACHE_TTL)
    return base


async def _build_leaderboard_payload(user: Users, db: AsyncSession, education_level: str | None, course: int | None, categories: list[str] | None, group: str | None, category_logic: str = 'or', season: str = 'current', full_users: bool = False):
    categories = [c for c in (categories or []) if c and c != 'all']

    # Staff export serializes every row fully and is rare — skip the cache.
    if full_users:
        base = await _compute_ranked_base(user, db, education_level, course, categories, group, category_logic, season, full_users=True)
    else:
        base = await _cached_ranked_base(user, db, education_level, course, categories, group, category_logic, season)

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
                'points_breakdown': row.get('points_breakdown', []),
                'previous_rank': row.get('previous_rank'),
                'previous_season': row.get('previous_season'),
                'is_me': is_me,
            }
        )

    flat_group_mapping = {
        level: [group for groups in by_course.values() for group in groups]
        for level, by_course in GROUP_MAPPING.items()
    }

    params = _build_query_params(education_level, course, categories, group, category_logic, season)
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
        'ranking_scope': season,
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
    season: str = Query('current'),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.status == UserStatus.DELETED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Аккаунт удалён. Доступна только поддержка.')

    selected = categories if categories else ([category] if category else [])
    # scope=global lets a student break out of their own stream and see everyone.
    if scope == 'global' and not current_user.is_staff:
        return await _build_leaderboard_payload(current_user, db, 'all', 0, selected, 'all', category_logic, season)

    course_int = int(course) if course and course.isdigit() else None
    scoped_education_level = _scoped_education_level(current_user, education_level)
    scoped_course = _scoped_course(current_user, course_int)
    scoped_group = group or 'all'
    return await _build_leaderboard_payload(current_user, db, scoped_education_level, scoped_course, selected, scoped_group, category_logic, season)


@router.get('/seasons')
async def completed_seasons(
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
    course_int = int(course) if course and course.isdigit() else None
    if scope == 'global' and not current_user.is_staff:
        scoped_education_level, scoped_course, scoped_group = 'all', 0, 'all'
    else:
        scoped_education_level = _scoped_education_level(current_user, education_level)
        scoped_course = _scoped_course(current_user, course_int)
        scoped_group = group or 'all'

    selected_categories = [item for item in (categories or ([category] if category else [])) if item and item != 'all']
    seasons = (await db.execute(
        select(Season)
        .where(Season.status.in_(['published', 'archived']))
        .order_by(Season.results_published_at.desc().nullslast(), Season.start_at.desc(), Season.id.desc())
    )).scalars().all()
    rows = []
    for season in seasons:
        fallback_category_points = await _archived_category_points_by_user(db, season) if selected_categories else {}
        result_stmt = (
            select(SeasonResult, Users)
            .join(Users, Users.id == SeasonResult.user_id)
            .filter(
                or_(
                    SeasonResult.season_id == season.id,
                    and_(SeasonResult.season_id.is_(None), SeasonResult.season_name == season.name),
                ),
                Users.role == UserRole.STUDENT,
                Users.status != UserStatus.DELETED,
            )
        )
        result_stmt = _apply_student_scope(
            result_stmt,
            current_user,
            scoped_education_level,
            scoped_course,
            scoped_group,
        )
        result_rows = (await db.execute(result_stmt)).all()
        if selected_categories:
            result_rows = [
                (result, student)
                for result, student in result_rows
                if _season_result_matches_categories(
                    result,
                    selected_categories,
                    category_logic,
                    fallback_category_points.get(result.user_id),
                )
            ]
        rows.append((season, len(result_rows)))
    return {
        'seasons': [
            {
                'id': season.id,
                'name': season.name,
                'status': season.status,
                'start_at': season.start_at.isoformat(),
                'ended_at': (season.results_published_at or season.finalized_at or season.moderation_close_at or season.submissions_close_at).isoformat() if (season.results_published_at or season.finalized_at or season.moderation_close_at or season.submissions_close_at) else None,
                'created_at': season.results_published_at.isoformat() if season.results_published_at else None,
                'participants': participants,
            }
            for season, participants in rows
        ]
    }


def _season_result_category_points(result: SeasonResult, fallback: dict[str, int] | None = None) -> dict[str, int]:
    raw = result.category_points if isinstance(result.category_points, dict) else {}
    normalized = {str(key): int(value or 0) for key, value in raw.items()}
    return normalized or dict(fallback or {})


def _season_result_matches_categories(
    result: SeasonResult,
    categories: list[str],
    category_logic: str,
    fallback: dict[str, int] | None = None,
) -> bool:
    points = _season_result_category_points(result, fallback)
    matches = [points.get(item, 0) > 0 for item in categories]
    return all(matches) if category_logic == 'and' and len(matches) > 1 else any(matches)


async def _archived_category_points_by_user(db: AsyncSession, season: Season) -> dict[int, dict[str, int]]:
    rows = (await db.execute(
        select(
            Achievement.user_id,
            Achievement.category,
            func.coalesce(func.sum(Achievement.points), 0).label('points'),
        )
        .where(_approved_achievement_condition(season.name))
        .group_by(Achievement.user_id, Achievement.category)
    )).all()
    result: dict[int, dict[str, int]] = {}
    for user_id, category, points in rows:
        label = category.value if hasattr(category, 'value') else str(category)
        result.setdefault(user_id, {})[label] = int(points or 0)
    return result


@router.get('/seasons/{season_name}')
async def completed_season_results(
    season_name: str,
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
    course_int = int(course) if course and course.isdigit() else None
    if scope == 'global' and not current_user.is_staff:
        scoped_education_level, scoped_course, scoped_group = 'all', 0, 'all'
    else:
        scoped_education_level = _scoped_education_level(current_user, education_level)
        scoped_course = _scoped_course(current_user, course_int)
        scoped_group = group or 'all'

    season = await db.scalar(
        select(Season).where(
            Season.name == season_name,
            Season.status.in_(['published', 'archived']),
        )
    )
    if not season:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Завершённый сезон не найден.')

    stmt = (
        select(SeasonResult, Users)
        .join(Users, Users.id == SeasonResult.user_id)
        .filter(
            or_(
                SeasonResult.season_id == season.id,
                and_(SeasonResult.season_id.is_(None), SeasonResult.season_name == season.name),
            ),
            Users.role == UserRole.STUDENT,
            Users.status != UserStatus.DELETED,
        )
    )
    stmt = _apply_student_scope(stmt, current_user, scoped_education_level, scoped_course, scoped_group)
    stmt = stmt.order_by(SeasonResult.rank.asc(), SeasonResult.id.asc())
    rows = (await db.execute(stmt)).all()
    selected_categories = [item for item in (categories or ([category] if category else [])) if item and item != 'all']
    fallback_category_points = await _archived_category_points_by_user(db, season)
    ranked_rows = []
    for result, student in rows:
        category_points = _season_result_category_points(result, fallback_category_points.get(result.user_id))
        if selected_categories and not _season_result_matches_categories(
            result,
            selected_categories,
            category_logic,
            fallback_category_points.get(result.user_id),
        ):
            continue
        points = sum(category_points.get(item, 0) for item in selected_categories) if selected_categories else int(result.points or 0)
        ranked_rows.append((result, student, points, category_points))
    ranked_rows.sort(key=lambda item: (-item[2], item[0].rank or 0, item[0].id))
    return {
        'season_name': season_name,
        'leaderboard': [
            {
                'rank': rank,
                'total_points': points,
                'user': serialize_user(student) if student.id == current_user.id else serialize_user_public(student),
                'is_me': student.id == current_user.id,
                'points_breakdown': [
                    {'label': label, 'points': value}
                    for label, value in sorted(category_points.items(), key=lambda item: item[1], reverse=True)
                    if value > 0 and (not selected_categories or label in selected_categories)
                ],
            }
            for rank, (result, student, points, category_points) in enumerate(ranked_rows, 1)
        ],
    }


@router.get('/export')
async def export_leaderboard(
    education_level: str | None = Query(None),
    course: str | None = Query(None),
    category: str | None = Query(None),
    categories: list[str] | None = Query(None),
    category_logic: str = Query('or'),
    group: str | None = Query(None),
    season: str = Query('current'),
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
    payload = await _build_leaderboard_payload(current_user, db, scoped_education_level, scoped_course, selected, scoped_group, category_logic, season, full_users=True)

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

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail='Сезон теперь закрывается поэтапно в разделе «Дашборд → Управление сезоном»: закрытие приёма, модерация, публикация.',
    )
