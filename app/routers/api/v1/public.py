from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth, auth_optional
from app.models.achievement import Achievement
from app.models.enums import AchievementStatus, UserRole, UserStatus
from app.models.user import Users
from app.utils import storage
from app.utils.media_paths import guess_media_type, resolve_static_path
from app.utils.points import aggregated_gpa_bonus_expr, calculate_gpa_bonus
from app.utils.rate_limiter import rate_limiter
from app.utils.season_history import load_season_history

from .serializers import serialize_achievement, serialize_user_public

router = APIRouter(prefix='/api/v1/public', tags=['api.v1.public'])

_STAFF_ROLES = (UserRole.MODERATOR, UserRole.SUPER_ADMIN)
_VISIBILITY_DEFAULTS = {
    'avatar': True,
    'gpa': True,
    'analytics': True,
    'achievements': True,
    'resume': True,
    'score': True,
    'hall_of_fame': True,
}


def _approved_archive_filter():
    """Public analytics may use only documents approved before archiving."""
    return or_(
        Achievement.archived_from_status == AchievementStatus.APPROVED.value,
        # Releases before archived_from_status existed archived approved rows only.
        Achievement.archived_from_status.is_(None),
    )

async def _enforce_public_rate_limit(request: Request, bucket: str) -> None:
    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'public_{bucket}:{client_ip}'
    hits = int(await rate_limiter.increment(rl_key, settings.PUBLIC_PROFILE_TTL))
    if hits > settings.PUBLIC_PROFILE_MAX_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail='Слишком много запросов. Попробуйте позже.',
        )


def _can_view_documents(viewer: Users | None, student_id: int) -> bool:
    if viewer is None:
        return False
    if int(viewer.id) == int(student_id):
        return True
    return UserRole(viewer.role) in _STAFF_ROLES


@router.get('/students/{student_id}')
async def public_student_profile(
    student_id: int,
    request: Request,
    season: str = Query(default='current', max_length=100),
    db: AsyncSession = Depends(get_db),
    viewer: Users | None = Depends(auth_optional),
):
    await _enforce_public_rate_limit(request, 'profile')
    student = await db.get(Users, student_id)
    if not student or student.role != UserRole.STUDENT or student.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Student not found.')

    current_achievements_stmt = (
        select(Achievement)
        .filter(Achievement.user_id == student_id, Achievement.status == AchievementStatus.APPROVED)
        .order_by(Achievement.created_at.desc())
    )
    current_achievements = (await db.execute(current_achievements_stmt)).scalars().all()
    season_history = await load_season_history(db, student_id)

    season = (season or 'current').strip()
    archived_approved = and_(
        Achievement.status == AchievementStatus.ARCHIVED,
        _approved_archive_filter(),
    )
    selected_names: list[str] = []
    if season == 'current':
        selected_filter = Achievement.status == AchievementStatus.APPROVED
    elif season == 'all':
        selected_filter = or_(Achievement.status == AchievementStatus.APPROVED, archived_approved)
    elif season == 'last2':
        selected_names = [item.season_name for item in season_history[:1]]
        selected_filter = or_(
            Achievement.status == AchievementStatus.APPROVED,
            and_(archived_approved, Achievement.archived_season.in_(selected_names)),
        )
    else:
        known_names = {item.season_name for item in season_history}
        if season not in known_names:
            raise HTTPException(status_code=422, detail='Неизвестный сезон.')
        selected_filter = and_(archived_approved, Achievement.archived_season == season)

    achievements_stmt = (
        select(Achievement)
        .filter(Achievement.user_id == student_id, selected_filter)
        .order_by(Achievement.created_at.desc())
    )
    achievements = (await db.execute(achievements_stmt)).scalars().all()

    gpa_bonus = calculate_gpa_bonus(student.session_gpa)
    total_points = sum(int(item.points or 0) for item in current_achievements) + gpa_bonus

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
    leaderboard_rows = (await db.execute(leaderboard_stmt)).all()

    rank = None
    for index, (user_id, _points) in enumerate(leaderboard_rows, 1):
        if int(user_id) == int(student_id):
            rank = index
            break
    global_total = len(leaderboard_rows)

    # Rank within the student's own group (поток/группа).
    group_rank = None
    group_total = 0
    if student.study_group:
        group_stmt = (
            select(Users.id, total_points_expr)
            .outerjoin(Achievement, (Users.id == Achievement.user_id) & (Achievement.status == AchievementStatus.APPROVED))
            .filter(
                Users.role == UserRole.STUDENT,
                Users.status == UserStatus.ACTIVE,
                Users.study_group == student.study_group,
            )
            .group_by(Users.id)
            .order_by(desc('total_points'))
        )
        group_rows = (await db.execute(group_stmt)).all()
        group_total = len(group_rows)
        for index, (user_id, _points) in enumerate(group_rows, 1):
            if int(user_id) == int(student_id):
                group_rank = index
                break

    approved_rows = (
        await db.execute(
            select(
                func.date_trunc('month', Achievement.created_at).label('bucket'),
                func.count().label('count'),
                func.coalesce(func.sum(Achievement.points), 0).label('points'),
            )
            .filter(Achievement.user_id == student_id, selected_filter)
            .group_by('bucket')
            .order_by('bucket')
        )
    ).all()
    upload_rows = (
        await db.execute(
            select(
                func.date_trunc('month', Achievement.created_at).label('bucket'),
                func.count().label('count'),
            )
            .filter(Achievement.user_id == student_id, selected_filter)
            .group_by('bucket')
            .order_by('bucket')
        )
    ).all()

    all_months: dict[str, dict[str, int | object]] = {}
    for row in approved_rows:
        if row.bucket is None:
            continue
        key = row.bucket.strftime('%m.%Y')
        all_months.setdefault(key, {'points': 0, 'uploads': 0, 'sort': row.bucket})
        all_months[key]['points'] = int(row.points or 0)
    for row in upload_rows:
        if row.bucket is None:
            continue
        key = row.bucket.strftime('%m.%Y')
        all_months.setdefault(key, {'points': 0, 'uploads': 0, 'sort': row.bucket})
        all_months[key]['uploads'] = int(row.count or 0)

    sorted_months = sorted(all_months.items(), key=lambda item: item[1]['sort'])
    if not sorted_months:
        now = datetime.now()
        sorted_months = [(now.strftime('%m.%Y'), {'points': 0, 'uploads': 0, 'sort': now})]
    chart_labels = [item[0] for item in sorted_months]
    chart_points = [int(item[1]['points']) for item in sorted_months]
    chart_uploads = [int(item[1]['uploads']) for item in sorted_months]
    chart_cumulative: list[int] = []
    running_total = 0
    for points in chart_points:
        running_total += points
        chart_cumulative.append(running_total)

    category_breakdown: dict[str, dict[str, int]] = {}
    for achievement in achievements:
        category = achievement.category.value if getattr(achievement, 'category', None) else 'Other'
        entry = category_breakdown.setdefault(category, {'count': 0, 'points': 0})
        entry['count'] += 1
        entry['points'] += int(achievement.points or 0)

    can_view_docs = _can_view_documents(viewer, student_id)
    visibility = {
        key: bool((student.public_visibility or {}).get(key, default))
        for key, default in _VISIBILITY_DEFAULTS.items()
    }
    achievements_payload = []
    for achievement in achievements if visibility['achievements'] else []:
        item = serialize_achievement(achievement)
        if not visibility['score']:
            item['points'] = 0
        item['preview_url'] = (
            f'/api/v1/public/students/{student_id}/documents/{achievement.id}/preview'
            if achievement.file_path and can_view_docs else None
        )
        achievements_payload.append(item)

    student_payload = serialize_user_public(student)
    if not visibility['avatar']:
        student_payload['avatar_path'] = None
    if not visibility['gpa']:
        student_payload['session_gpa'] = None
    student_payload['resume_text'] = student.resume_text if visibility['resume'] else None

    return {
        'student': student_payload,
        'achievements': achievements_payload,
        'total_points': total_points if visibility['score'] else None,
        'total_docs': len(achievements) if visibility['achievements'] else None,
        'rank': rank if visibility['score'] else None,
        'global_total': global_total,
        'group_rank': group_rank if visibility['score'] else None,
        'group_total': group_total,
        'group_name': student.study_group,
        'gpa_bonus': gpa_bonus if visibility['gpa'] else 0,
        'season_history': [
            {
                'id': item.id,
                'season_name': item.season_name,
                'points': int(item.points or 0),
                'rank': int(item.rank or 0),
                'created_at': item.created_at.isoformat() if item.created_at else None,
            }
            for item in season_history
        ] if visibility['hall_of_fame'] else [],
        'chart_labels': chart_labels if visibility['analytics'] else [],
        'chart_points': chart_points if visibility['analytics'] and visibility['score'] else ([0] * len(chart_labels) if visibility['analytics'] else []),
        'chart_uploads': chart_uploads if visibility['analytics'] else [],
        'chart_cumulative': chart_cumulative if visibility['analytics'] and visibility['score'] else ([0] * len(chart_labels) if visibility['analytics'] else []),
        'has_chart_data': bool(chart_labels) and visibility['analytics'],
        'category_breakdown': [
            {
                'category': category,
                'count': values['count'],
                'points': values['points'] if visibility['score'] else 0,
            }
            for category, values in sorted(category_breakdown.items(), key=lambda item: (-item[1]['count'], item[0]))
        ] if visibility['analytics'] else [],
        'public_visibility': visibility,
        'selected_season': season,
        'available_seasons': [item.season_name for item in season_history],
        'public_url': f'/sirius.achievements/app/students/{student_id}',
    }


@router.get('/students/{student_id}/documents/{document_id}/preview')
async def public_document_preview(
    student_id: int,
    document_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    viewer: Users = Depends(auth),
):
    """Serve approved achievement documents. Only the owner or staff (mod/admin) may view."""
    await _enforce_public_rate_limit(request, 'doc')
    if not _can_view_documents(viewer, student_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Access denied.')

    student = await db.get(Users, student_id)
    if not student or student.role != UserRole.STUDENT or student.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Student not found.')

    achievement = await db.get(Achievement, document_id)
    if (
        not achievement
        or achievement.user_id != student_id
        or not (
            achievement.status == AchievementStatus.APPROVED
            or (
                achievement.status == AchievementStatus.ARCHIVED
                and (achievement.archived_from_status in {None, AchievementStatus.APPROVED.value})
            )
        )
        or not achievement.file_path
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Document not found.')

    file_path = achievement.file_path

    if storage.is_minio_path(file_path):
        key = storage.extract_key(file_path)
        try:
            data = await storage.download(key)
        except Exception as exc:
            raise HTTPException(status_code=404, detail='File not found.') from exc
        filename = key.rsplit('/', 1)[-1]
        return StreamingResponse(
            __import__('io').BytesIO(data),
            media_type=guess_media_type(filename),
            headers={'Content-Disposition': f'inline; filename="{filename}"'},
        )

    try:
        full_path = resolve_static_path(file_path)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail='Invalid file path') from exc

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail='File not found.')

    response = FileResponse(path=full_path, media_type=guess_media_type(full_path))
    response.headers['Content-Disposition'] = f'inline; filename="{full_path.name}"'
    return response
