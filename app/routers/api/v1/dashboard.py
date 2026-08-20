from __future__ import annotations

import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, literal_column, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.bug_report import BugReport
from app.models.enums import AchievementCategory, AchievementStatus, SupportTicketStatus, UserRole, UserStatus
from app.models.notification import Notification
from app.models.support_message import SupportMessage
from app.models.support_ticket import SupportTicket
from app.models.user import Users
from app.utils.cache import cache_get_json, cache_set_json
from app.utils.points import aggregated_gpa_bonus_expr, calculate_gpa_bonus

from .serializers import serialize_achievement

# The staff dashboard is a scope-aggregate (no per-user fields), so all staff in
# the same zone + period share one cached result. Short TTL; fail-open.
DASHBOARD_CACHE_TTL = int(os.getenv('DASHBOARD_CACHE_TTL', 30))


def _staff_dashboard_cache_key(user: Users, period: str, date_from: str | None, date_to: str | None) -> str:
    if user.role == UserRole.MODERATOR and user.education_level:
        zone = f'mod:{user.education_level_value}:{user.moderator_courses or ""}:{user.moderator_groups or ""}'
    else:
        zone = 'all'
    return f'dash:{zone}|p={period}|from={date_from or ""}|to={date_to or ""}'

router = APIRouter(prefix='/api/v1/dashboard', tags=['api.v1.dashboard'])


def _parse_seen_at(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def _iso_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


@router.get('/inbox-counts')
async def inbox_counts(
    users_seen_at: str | None = Query(default=None),
    achievements_seen_at: str | None = Query(default=None),
    support_seen_at: str | None = Query(default=None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    user = current_user
    generated_at = _iso_now()
    users_seen_after = _parse_seen_at(users_seen_at)
    achievements_seen_after = _parse_seen_at(achievements_seen_at)
    support_seen_after = _parse_seen_at(support_seen_at)

    if user.is_staff:
        users_stmt = select(func.count()).select_from(Users).filter(Users.status == UserStatus.PENDING)
        users_stmt = _apply_staff_user_scope(users_stmt, user)
        if users_seen_after:
            users_stmt = users_stmt.filter(Users.created_at > users_seen_after)

        achievements_stmt = (
            select(func.count())
            .select_from(Achievement)
            .join(Users, Achievement.user_id == Users.id)
            .filter(Achievement.status == AchievementStatus.PENDING)
        )
        achievements_stmt = _apply_staff_user_scope(achievements_stmt, user)
        if achievements_seen_after:
            achievements_stmt = achievements_stmt.filter(Achievement.created_at > achievements_seen_after)

        support_stmt = (
            select(func.count(func.distinct(SupportTicket.id)))
            .select_from(SupportTicket)
            .join(Users, SupportTicket.user_id == Users.id)
            .outerjoin(
                SupportMessage,
                (SupportMessage.ticket_id == SupportTicket.id)
                & (SupportMessage.is_from_moderator.is_(False)),
            )
            .filter(
                SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
                SupportTicket.archived_at.is_(None),
            )
        )
        support_stmt = _apply_staff_user_scope(support_stmt, user)
        if support_seen_after:
            support_stmt = support_stmt.filter(
                or_(
                    SupportTicket.created_at > support_seen_after,
                    SupportMessage.created_at > support_seen_after,
                )
            )

        pending_users = (await db.execute(users_stmt)).scalar() or 0
        pending_achievements = (await db.execute(achievements_stmt)).scalar() or 0
        new_support = (await db.execute(support_stmt)).scalar() or 0
        bug_reports = 0
        if user.role == UserRole.SUPER_ADMIN:
            bug_reports = (await db.execute(select(func.count()).select_from(BugReport))).scalar() or 0

        total = int(pending_users or 0) + int(pending_achievements or 0) + int(new_support or 0) + int(bug_reports or 0)
        return {
            'pending_users': int(pending_users or 0),
            'pending_achievements': int(pending_achievements or 0),
            'new_support': int(new_support or 0),
            'bug_reports': int(bug_reports or 0),
            'total': total,
            'generated_at': generated_at,
        }

    support_unread = (await db.execute(
        select(func.count()).filter(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
            Notification.link.ilike('%/support%'),
            *( [Notification.created_at > support_seen_after] if support_seen_after else [] ),
        )
    )).scalar() or 0

    return {
        'support_unread': int(support_unread or 0),
        'total': int(support_unread or 0),
        'generated_at': generated_at,
    }


def _apply_student_stream_scope(stmt, user: Users):
    if user.education_level is not None:
        stmt = stmt.filter(Users.education_level == user.education_level)
    if user.course:
        stmt = stmt.filter(Users.course == user.course)
    if user.study_group:
        stmt = stmt.filter(Users.study_group == user.study_group)
    return stmt


def _split_csv(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(',') if item.strip()}


def _apply_staff_user_scope(stmt, user: Users):
    if user.role != UserRole.MODERATOR:
        return stmt
    if user.education_level:
        stmt = stmt.filter(Users.education_level == user.education_level)
    courses = _split_csv(getattr(user, 'moderator_courses', None))
    if courses:
        stmt = stmt.filter(Users.course.in_([int(item) for item in courses if item.isdigit()]))
    groups = _split_csv(getattr(user, 'moderator_groups', None))
    if groups:
        stmt = stmt.filter(Users.study_group.in_(groups))
    return stmt


def _staff_scoped_achievement_stmt(stmt, user: Users):
    stmt = stmt.select_from(Achievement).join(Users, Achievement.user_id == Users.id)
    return _apply_staff_user_scope(stmt, user)


def _staff_scoped_support_stmt(stmt, user: Users):
    stmt = stmt.select_from(SupportTicket).join(Users, SupportTicket.user_id == Users.id)
    return _apply_staff_user_scope(stmt, user)


def _parse_date_range(period: str, date_from: str | None, date_to: str | None):
    now = datetime.now()
    start_date = datetime(2020, 1, 1)
    end_date = now + timedelta(days=1)
    date_trunc = 'month'
    date_fmt = '%m.%Y'

    if period == 'day':
        start_date = now - timedelta(days=1)
        date_trunc = 'hour'
        date_fmt = '%H:00'
    elif period == 'week':
        start_date = now - timedelta(weeks=1)
        date_trunc = 'day'
        date_fmt = '%d.%m'
    elif period == 'month':
        start_date = now - timedelta(days=30)
        date_trunc = 'day'
        date_fmt = '%d.%m'

    if date_from:
        start_date = datetime.strptime(date_from, '%Y-%m-%d')
        date_trunc = 'day'
        date_fmt = '%d.%m'
    if date_to:
        end_date = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
        date_trunc = 'day'
        date_fmt = '%d.%m'

    return start_date, end_date, date_trunc, date_fmt


def _percent_change(current: int, previous: int) -> int:
    if previous == 0:
        return 100 if current > 0 else 0
    return round(((current - previous) / previous) * 100)


@router.get('')
@router.get('/')
async def dashboard(
    period: str = Query(default='all'),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    user = current_user

    if user.status == UserStatus.DELETED and not user.is_staff:
        return {'deleted_account': True}

    if user.status == UserStatus.PENDING and not user.is_staff:
        return {'pending_review': True}

    start_date, end_date, date_trunc, date_fmt = _parse_date_range(period, date_from, date_to)

    include_gpa_bonus = period == 'all'

    if user.is_staff:
        _dash_key = _staff_dashboard_cache_key(user, period, date_from, date_to)
        _cached = await cache_get_json(_dash_key)
        if _cached is not None:
            return _cached

        new_users_stmt = _apply_staff_user_scope(
            select(func.count())
            .select_from(Users)
            .filter(
                Users.role == UserRole.STUDENT,
                Users.status != UserStatus.REJECTED,
                Users.created_at >= start_date,
                Users.created_at < end_date,
            ),
            user,
        )
        new_users_count = (await db.execute(new_users_stmt)).scalar() or 0

        user_stats_stmt = _apply_staff_user_scope(
            select(
                func.count().label('total'),
                func.count().filter(Users.status == UserStatus.ACTIVE).label('active'),
                func.count().filter(Users.status == UserStatus.PENDING).label('pending'),
                func.count().filter(Users.status == UserStatus.DELETED).label('deleted'),
                func.count().filter(Users.status == UserStatus.REJECTED).label('rejected'),
                func.count().filter(Users.role == UserRole.MODERATOR).label('moderators'),
                func.count().filter(Users.role == UserRole.STUDENT).label('students'),
            )
            .select_from(Users)
            .filter(Users.status != UserStatus.REJECTED),
            user,
        )
        user_stats = (await db.execute(
            user_stats_stmt
        )).first()

        ach_stats_stmt = _staff_scoped_achievement_stmt(
            select(
                func.count().filter(Achievement.status == AchievementStatus.PENDING, Achievement.created_at >= start_date, Achievement.created_at < end_date).label('pending'),
                func.count().filter(Achievement.status == AchievementStatus.APPROVED, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('approved'),
                func.count().filter(Achievement.status == AchievementStatus.REJECTED, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('rejected'),
                func.count().filter(Achievement.status == AchievementStatus.REVISION, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('revision'),
                func.count().filter(Achievement.created_at >= start_date, Achievement.created_at < end_date).label('total'),
                func.count().filter(Achievement.file_path.isnot(None), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('with_file'),
                func.count().filter(Achievement.external_url.isnot(None), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('with_link'),
            ),
            user,
        )
        ach_stats = (await db.execute(ach_stats_stmt)).first()

        overdue_before = datetime.now() - timedelta(hours=48)
        queue_stats_stmt = _staff_scoped_achievement_stmt(
            select(
                func.count().filter(
                    Achievement.status == AchievementStatus.PENDING,
                    Achievement.moderator_id.is_(None),
                ).label('free'),
                func.count().filter(
                    Achievement.status == AchievementStatus.PENDING,
                    Achievement.moderator_id == user.id,
                ).label('mine'),
                func.count().filter(
                    Achievement.status == AchievementStatus.PENDING,
                    Achievement.created_at < overdue_before,
                ).label('overdue'),
            ),
            user,
        )
        queue_stats = (await db.execute(queue_stats_stmt)).first()

        trend = None
        if period != 'all' or date_from or date_to:
            comparison_window = end_date - start_date
            previous_start = start_date - comparison_window
            previous_end = start_date
            previous_users_stmt = _apply_staff_user_scope(
                select(func.count()).select_from(Users).filter(
                    Users.role == UserRole.STUDENT,
                    Users.status != UserStatus.REJECTED,
                    Users.created_at >= previous_start,
                    Users.created_at < previous_end,
                ),
                user,
            )
            previous_achievements_stmt = _staff_scoped_achievement_stmt(
                select(
                    func.count().filter(
                        Achievement.created_at >= previous_start,
                        Achievement.created_at < previous_end,
                    ).label('total'),
                    func.count().filter(
                        Achievement.status == AchievementStatus.APPROVED,
                        Achievement.updated_at >= previous_start,
                        Achievement.updated_at < previous_end,
                    ).label('approved'),
                ),
                user,
            )
            previous_users = int((await db.execute(previous_users_stmt)).scalar() or 0)
            previous_achievements = (await db.execute(previous_achievements_stmt)).first()
            trend = {
                'new_users': _percent_change(int(new_users_count), previous_users),
                'documents': _percent_change(int(ach_stats.total or 0), int(previous_achievements.total or 0)),
                'approved': _percent_change(int(ach_stats.approved or 0), int(previous_achievements.approved or 0)),
            }

        support_stats_stmt = _staff_scoped_support_stmt(
            select(
                func.count().filter(SupportTicket.created_at >= start_date, SupportTicket.created_at < end_date).label('total'),
                func.count().filter(SupportTicket.status == SupportTicketStatus.OPEN, SupportTicket.archived_at.is_(None)).label('open'),
                func.count().filter(SupportTicket.status == SupportTicketStatus.IN_PROGRESS, SupportTicket.archived_at.is_(None)).label('in_progress'),
                func.count().filter(or_(SupportTicket.status == SupportTicketStatus.CLOSED, SupportTicket.archived_at.is_not(None))).label('closed'),
            ),
            user,
        )
        support_stats = (await db.execute(support_stats_stmt)).first()

        points_expr = (
            func.coalesce(func.sum(Achievement.points), 0)
            + aggregated_gpa_bonus_expr(Users.session_gpa, include_bonus=include_gpa_bonus)
        )
        top_students_stmt = (
            select(Users, points_expr.label('points'))
            .outerjoin(
                Achievement,
                (Users.id == Achievement.user_id)
                & (Achievement.status == AchievementStatus.APPROVED)
                & (Achievement.updated_at >= start_date)
                & (Achievement.updated_at < end_date),
            )
            .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
            .group_by(Users.id)
            .having(points_expr > 0)
            .order_by(desc('points'))
            .limit(5)
        )
        top_students_stmt = _apply_staff_user_scope(top_students_stmt, user)
        top_students_rows = (await db.execute(top_students_stmt)).all()

        recent_stmt = (
            select(Achievement)
            .options(selectinload(Achievement.user))
            .join(Users, Achievement.user_id == Users.id)
            .filter(Achievement.created_at >= start_date, Achievement.created_at < end_date)
            .order_by(Achievement.created_at.desc())
            .limit(5)
        )
        recent_stmt = _apply_staff_user_scope(recent_stmt, user)
        recent_achievements = (await db.execute(recent_stmt)).scalars().all()

        chart_stmt = _staff_scoped_achievement_stmt(
            select(
                func.date_trunc(date_trunc, Achievement.created_at).label('bucket'),
                func.count().label('cnt'),
            )
            .filter(Achievement.created_at >= start_date, Achievement.created_at < end_date)
            .group_by(literal_column('bucket'))
            .order_by(literal_column('bucket')),
            user,
        )
        chart_rows = (await db.execute(chart_stmt)).all()

        course_activity_stmt = _staff_scoped_achievement_stmt(
            select(
                Users.course.label('label'),
                func.count().label('count'),
                func.count().filter(Achievement.status == AchievementStatus.PENDING).label('pending'),
            )
            .filter(
                Achievement.created_at >= start_date,
                Achievement.created_at < end_date,
                Users.course.isnot(None),
            )
            .group_by(Users.course)
            .order_by(Users.course.asc()),
            user,
        )
        course_rows = (await db.execute(course_activity_stmt)).all()

        group_activity_stmt = _staff_scoped_achievement_stmt(
            select(
                Users.study_group.label('label'),
                Users.course.label('course'),
                func.count().label('count'),
                func.count().filter(Achievement.status == AchievementStatus.PENDING).label('pending'),
            )
            .filter(
                Achievement.created_at >= start_date,
                Achievement.created_at < end_date,
                Users.study_group.isnot(None),
            )
            .group_by(Users.study_group, Users.course)
            .order_by(Users.course.asc(), Users.study_group.asc()),
            user,
        )
        group_rows = (await db.execute(group_activity_stmt)).all()

        category_stmt = _staff_scoped_achievement_stmt(
            select(
                Achievement.category,
                func.count().label('count'),
                func.coalesce(func.sum(Achievement.points), 0).label('points'),
            )
            .filter(Achievement.created_at >= start_date, Achievement.created_at < end_date)
            .group_by(Achievement.category)
            .order_by(desc('count')),
            user,
        )
        category_rows = (await db.execute(category_stmt)).all()

        active_categories = {row.category.value if hasattr(row.category, 'value') else str(row.category) for row in category_rows if row.category}
        recommendations = [
            {
                'title': f'Усилить направление «{category.value}»',
                'message': 'В выбранном периоде мало подтверждений по этому направлению. Можно отдельно напомнить студентам загрузить документы.',
                'action_label': 'Открыть документы направления',
                'action_url': f'/documents?category={category.value}',
            }
            for category in AchievementCategory
            if category.value not in active_categories
        ][:3]

        _dash_payload = {
            'date_from': start_date.date().isoformat(),
            'date_to': (end_date - timedelta(days=1)).date().isoformat(),
            'new_users_count': int(new_users_count),
            'pending_achievements': int(ach_stats.pending or 0),
            'approved_achievements': int(ach_stats.approved or 0),
            'rejected_achievements': int(ach_stats.rejected or 0),
            'total_achievements': int(ach_stats.total or 0),
            'staff_queue': {
                'free': int(queue_stats.free or 0),
                'mine': int(queue_stats.mine or 0),
                'overdue': int(queue_stats.overdue or 0),
            },
            'trend': trend,
            'users_stats': {
                'total': int(user_stats.total or 0),
                'active': int(user_stats.active or 0),
                'pending': int(user_stats.pending or 0),
                'deleted': int(user_stats.deleted or 0),
                'rejected': int(user_stats.rejected or 0),
                'students': int(user_stats.students or 0),
                'moderators': int(user_stats.moderators or 0),
            },
            'documents_stats': {
                'total': int(ach_stats.total or 0),
                'pending': int(ach_stats.pending or 0),
                'approved': int(ach_stats.approved or 0),
                'rejected': int(ach_stats.rejected or 0),
                'revision': int(ach_stats.revision or 0),
                'with_file': int(ach_stats.with_file or 0),
                'with_link': int(ach_stats.with_link or 0),
            },
            'support_stats': {
                'total': int(support_stats.total or 0),
                'open': int(support_stats.open or 0),
                'in_progress': int(support_stats.in_progress or 0),
                'closed': int(support_stats.closed or 0),
            },
            'top_students': [
                {
                    'id': row[0].id,
                    'first_name': row[0].first_name,
                    'last_name': row[0].last_name,
                    'education_level': row[0].education_level_value,
                    'course': row[0].course,
                    'study_group': row[0].study_group,
                    'points': int(row[1] or 0),
                }
                for row in top_students_rows
            ],
            'recent_achievements': [serialize_achievement(item) for item in recent_achievements],
            'chart_data': {
                'labels': [row.bucket.strftime(date_fmt) for row in chart_rows] if chart_rows else [],
                'counts': [int(row.cnt or 0) for row in chart_rows] if chart_rows else [],
                'dates': [row.bucket.date().isoformat() for row in chart_rows] if chart_rows else [],
            },
            'cohorts': [
                {
                    'education_level': f'{int(row.label)} курс',
                    'kind': 'course',
                    'count': int(row.count or 0),
                    'total': int(row.count or 0),
                    'pending': int(row.pending or 0),
                    'approved': max(int(row.count or 0) - int(row.pending or 0), 0),
                }
                for row in course_rows
                if row.label is not None
            ] + [
                {
                    'education_level': str(row.label),
                    'kind': 'group',
                    'parent_course': int(row.course) if row.course is not None else None,
                    'count': int(row.count or 0),
                    'total': int(row.count or 0),
                    'pending': int(row.pending or 0),
                    'approved': max(int(row.count or 0) - int(row.pending or 0), 0),
                }
                for row in group_rows
                if row.label
            ],
            'category_activity': [
                {
                    'category': row.category.value if hasattr(row.category, 'value') else str(row.category),
                    'count': int(row.count or 0),
                    'points': int(row.points or 0),
                }
                for row in category_rows if row.category is not None
            ],
            'recommendations': recommendations,
        }
        await cache_set_json(_dash_key, _dash_payload, DASHBOARD_CACHE_TTL)
        return _dash_payload

    achievement_points = (await db.execute(
        select(func.coalesce(func.sum(Achievement.points), 0)).filter(
            Achievement.user_id == user.id,
            Achievement.status == AchievementStatus.APPROVED,
            Achievement.updated_at >= start_date,
            Achievement.updated_at < end_date,
        )
    )).scalar() or 0
    gpa_bonus = calculate_gpa_bonus(user.session_gpa) if include_gpa_bonus else 0
    my_points = int(achievement_points) + int(gpa_bonus)

    doc_stats = (await db.execute(
        select(
            func.count().filter(Achievement.user_id == user.id, Achievement.created_at >= start_date, Achievement.created_at < end_date).label('total'),
            func.count().filter(Achievement.user_id == user.id, Achievement.status == AchievementStatus.PENDING, Achievement.created_at >= start_date, Achievement.created_at < end_date).label('pending'),
            func.count().filter(Achievement.user_id == user.id, Achievement.status == AchievementStatus.APPROVED, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('approved'),
            func.count().filter(Achievement.user_id == user.id, Achievement.status == AchievementStatus.REJECTED, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('rejected'),
            func.count().filter(Achievement.user_id == user.id, Achievement.status == AchievementStatus.REVISION).label('revision'),
        )
    )).first()

    total_points_expr = (
        func.coalesce(func.sum(Achievement.points), 0)
        + aggregated_gpa_bonus_expr(Users.session_gpa, include_bonus=include_gpa_bonus)
    ).label('total_points')
    subquery_points = (
        select(Users.id.label('user_id'), total_points_expr)
        .outerjoin(
            Achievement,
            (Users.id == Achievement.user_id)
            & (Achievement.status == AchievementStatus.APPROVED)
            & (Achievement.updated_at >= start_date)
            & (Achievement.updated_at < end_date),
        )
        .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
    )
    subquery_points = _apply_student_stream_scope(subquery_points, user)
    subquery_points = (
        subquery_points
        .group_by(Users.id)
        .subquery()
    )

    my_rank = 0
    points_to_next_rank = 0
    next_rank = 0
    if my_points > 0:
        better_than_me = (await db.execute(
            select(func.count()).filter(subquery_points.c.total_points > my_points)
        )).scalar() or 0
        my_rank = int(better_than_me) + 1
        next_points = (await db.execute(
            select(func.min(subquery_points.c.total_points)).filter(subquery_points.c.total_points > my_points)
        )).scalar()
        if next_points is not None and my_rank > 1:
            points_to_next_rank = max(int(next_points) - my_points, 0)
            next_rank = my_rank - 1

    recent_docs = (await db.execute(
        select(Achievement)
        .filter(Achievement.user_id == user.id, Achievement.created_at >= start_date, Achievement.created_at < end_date)
        .order_by(Achievement.created_at.desc())
        .limit(5)
    )).scalars().all()

    category_rows = (await db.execute(
        select(Achievement.category, func.sum(Achievement.points))
        .filter(
            Achievement.user_id == user.id,
            Achievement.status == AchievementStatus.APPROVED,
            Achievement.updated_at >= start_date,
            Achievement.updated_at < end_date,
        )
        .group_by(Achievement.category)
    )).all()

    category_breakdown = [
        {
            'category': row[0].value if hasattr(row[0], 'value') else row[0],
            'points': int(row[1] or 0),
        }
        for row in category_rows if row[0]
    ]
    if gpa_bonus > 0:
        category_breakdown.append({'category': 'GPA bonus', 'points': int(gpa_bonus)})

    achieved_categories = {item['category'] for item in category_breakdown}
    recommendations = [
        {
            'title': f'Попробуйте направление «{category.value}»',
            'message': 'Там пока мало подтверждённых достижений, поэтому новый документ поможет сделать профиль сбалансированнее.',
            'action_label': f'Добавить достижение в категории «{category.value}»',
            'action_url': f'/achievements?new=1&category={category.value}',
        }
        for category in AchievementCategory
        if category.value not in achieved_categories
    ][:3]

    profile_fields = [
        user.first_name,
        user.last_name,
        user.email,
        user.education_level,
        user.course,
        user.study_group,
        user.phone_number,
        user.avatar_path,
    ]
    profile_completion = round((sum(value not in (None, '') for value in profile_fields) / len(profile_fields)) * 100)

    return {
        'date_from': start_date.date().isoformat(),
        'date_to': (end_date - timedelta(days=1)).date().isoformat(),
        'my_points': my_points,
        'gpa_bonus': int(gpa_bonus),
        'my_docs': int(doc_stats.total or 0),
        'my_rank': my_rank,
        'next_rank': next_rank,
        'points_to_next_rank': points_to_next_rank,
        'profile_completion': profile_completion,
        'my_recent_docs': [serialize_achievement(item) for item in recent_docs],
        'category_breakdown': category_breakdown,
        'pending_achievements': int(doc_stats.pending or 0),
        'approved_achievements': int(doc_stats.approved or 0),
        'rejected_achievements': int(doc_stats.rejected or 0),
        'revision_achievements': int(doc_stats.revision or 0),
        'recommendations': recommendations,
    }

