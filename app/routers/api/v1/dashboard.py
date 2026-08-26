from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, false, func, literal_column, or_, select, true
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.bug_report import BugReport
from app.models.enums import AchievementCategory, AchievementStatus, SupportTicketStatus, UserRole, UserStatus
from app.models.notification import Notification
from app.models.season import Season
from app.models.season_result import SeasonResult
from app.models.support_message import SupportMessage
from app.models.support_ticket import SupportTicket
from app.models.user import Users
from app.services.season_service import get_live_season
from app.utils.cache import cache_get_json, cache_set_json
from app.utils.points import aggregated_gpa_bonus_expr, calculate_gpa_bonus

from .serializers import serialize_achievement

# The staff dashboard is a scope-aggregate (no per-user fields), so all staff in
# the same zone + period share one cached result. Short TTL; fail-open.
DASHBOARD_CACHE_TTL = int(os.getenv('DASHBOARD_CACHE_TTL', 30))


def _staff_dashboard_cache_key(user: Users, period: str, date_from: str | None, date_to: str | None, season: str) -> str:
    if user.role == UserRole.MODERATOR and user.education_level:
        zone = f'mod:{user.education_level_value}:{user.moderator_courses or ""}:{user.moderator_groups or ""}'
    else:
        zone = 'all'
    return f'dash:{zone}|viewer={user.id}|p={period}|from={date_from or ""}|to={date_to or ""}|season={season}'

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
        live_season = await get_live_season(db)
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
        achievements_stmt = achievements_stmt.filter(
            Achievement.season_id == live_season.id if live_season else false()
        )
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


def _naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_date_range(
    period: str,
    date_from: str | None,
    date_to: str | None,
    *,
    boundary_start: datetime | None = None,
    boundary_end: datetime | None = None,
):
    now = _naive_utc(boundary_end) or datetime.now()
    earliest = _naive_utc(boundary_start) or datetime(2020, 1, 1)
    start_date = earliest
    end_date = now
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

    start_date = max(start_date, earliest)
    if boundary_end:
        end_date = min(end_date, now)
    if start_date >= end_date:
        raise HTTPException(status_code=422, detail='Выбранный период не пересекается с датами сезона.')

    return start_date, end_date, date_trunc, date_fmt


def _percent_change(current: int, previous: int) -> int:
    if previous == 0:
        return 100 if current > 0 else 0
    return round(((current - previous) / previous) * 100)


def _achievement_season_condition(season: str):
    if season == 'global':
        return true()
    if season == 'current':
        # Keep the legacy archive marker in the condition while the explicit
        # season_id lifecycle is rolled out. This prevents old archived rows
        # without a season snapshot from leaking into current analytics.
        return and_(
            Achievement.archived_season.is_(None),
            Achievement.status != AchievementStatus.ARCHIVED,
        )
    return Achievement.archived_season == season


def _achievement_effective_status(season: str, status: AchievementStatus):
    current = and_(Achievement.status == status, Achievement.archived_season.is_(None))
    archived = and_(
        Achievement.status == AchievementStatus.ARCHIVED,
        Achievement.archived_from_status == status.value,
    )
    if status == AchievementStatus.APPROVED:
        archived = and_(
            Achievement.status == AchievementStatus.ARCHIVED,
            or_(
                Achievement.archived_from_status == AchievementStatus.APPROVED.value,
                Achievement.archived_from_status.is_(None),
            ),
        )
    preserved = or_(Achievement.status == status, archived)
    if status == AchievementStatus.APPROVED:
        preserved = and_(preserved, Achievement.eligible_for_ranking.is_(True))
    if season == 'global':
        return preserved
    if season == 'current':
        return current
    return and_(preserved, Achievement.archived_season == season)


async def _dashboard_seasons(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(Season, func.count(SeasonResult.id).label('participants'))
        .outerjoin(SeasonResult, SeasonResult.season_id == Season.id)
        .where(Season.status.in_(['published', 'archived']))
        .group_by(Season.id)
        .order_by(Season.start_at.desc(), Season.id.desc())
    )).all()
    return [
        {
            'id': season.id,
            'name': season.name,
            'status': season.status,
            'start_at': season.start_at.isoformat(),
            'ended_at': (season.results_published_at or season.finalized_at or season.moderation_close_at or season.submissions_close_at).isoformat() if (season.results_published_at or season.finalized_at or season.moderation_close_at or season.submissions_close_at) else None,
            'created_at': season.results_published_at.isoformat() if season.results_published_at else None,
            'participants': int(participants or 0),
        }
        for season, participants in rows
    ]


@router.get('')
@router.get('/')
async def dashboard(
    period: str = Query(default='all'),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    season: str = Query(default='current'),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    user = current_user

    if user.status == UserStatus.DELETED and not user.is_staff:
        return {'deleted_account': True}

    if user.status == UserStatus.PENDING and not user.is_staff:
        return {'pending_review': True}

    scoped_season = None
    if season == 'current':
        scoped_season = await get_live_season(db)
    elif season != 'global':
        scoped_season = await db.scalar(
            select(Season).where(
                Season.name == season,
                Season.status.in_(['published', 'archived']),
            )
        )
        if not scoped_season:
            raise HTTPException(status_code=404, detail='Сезон не найден.')

    season_end = None
    if scoped_season and season != 'current':
        season_end = (
            scoped_season.results_published_at
            or scoped_season.finalized_at
            or scoped_season.moderation_close_at
            or scoped_season.submissions_close_at
        )
    start_date, end_date, date_trunc, date_fmt = _parse_date_range(
        period,
        date_from,
        date_to,
        boundary_start=scoped_season.start_at if scoped_season else None,
        boundary_end=season_end,
    )

    include_gpa_bonus = period == 'all' and season == 'current'
    season_condition = _achievement_season_condition(season)
    approved_condition = _achievement_effective_status(season, AchievementStatus.APPROVED)
    available_seasons = await _dashboard_seasons(db)

    if user.is_staff:
        live_season = await get_live_season(db)
        _dash_key = _staff_dashboard_cache_key(user, period, date_from, date_to, season)
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
                func.count().filter(_achievement_effective_status(season, AchievementStatus.PENDING), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('pending'),
                func.count().filter(approved_condition, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('approved'),
                func.count().filter(_achievement_effective_status(season, AchievementStatus.REJECTED), Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('rejected'),
                func.count().filter(_achievement_effective_status(season, AchievementStatus.REVISION), Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('revision'),
                func.count().filter(season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date).label('total'),
                func.count().filter(season_condition, Achievement.file_path.isnot(None), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('with_file'),
                func.count().filter(season_condition, Achievement.external_url.isnot(None), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('with_link'),
            ),
            user,
        )
        ach_stats = (await db.execute(ach_stats_stmt)).first()

        overdue_before = datetime.now() - timedelta(hours=48)
        live_queue_condition = (
            Achievement.season_id == live_season.id if live_season else false()
        )
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
                func.count().filter(Achievement.status == AchievementStatus.REVISION).label('revision'),
            ),
            user,
        ).filter(live_queue_condition)
        queue_stats = (await db.execute(queue_stats_stmt)).first()

        current_participants_stmt = _staff_scoped_achievement_stmt(
            select(func.count(func.distinct(Achievement.user_id))),
            user,
        ).filter(live_queue_condition)
        current_participants = int((await db.execute(current_participants_stmt)).scalar() or 0)

        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_stats_stmt = _staff_scoped_achievement_stmt(
            select(
                func.count().filter(Achievement.created_at >= today_start).label('received'),
                func.count().filter(
                    Achievement.updated_at >= today_start,
                    Achievement.status.in_([
                        AchievementStatus.APPROVED,
                        AchievementStatus.REJECTED,
                        AchievementStatus.REVISION,
                    ]),
                ).label('reviewed'),
                func.avg(
                    func.extract(
                        'epoch',
                        Achievement.updated_at - func.coalesce(Achievement.submitted_at, Achievement.created_at),
                    )
                ).filter(
                    Achievement.status.in_([
                        AchievementStatus.APPROVED,
                        AchievementStatus.REJECTED,
                        AchievementStatus.REVISION,
                    ])
                ).label('average_review_seconds'),
            ),
            user,
        ).filter(live_queue_condition)
        today_stats = (await db.execute(today_stats_stmt)).first()

        continue_stmt = (
            select(Achievement.id)
            .join(Users, Achievement.user_id == Users.id)
            .filter(
                live_queue_condition,
                Achievement.status == AchievementStatus.PENDING,
                or_(Achievement.moderator_id == user.id, Achievement.moderator_id.is_(None)),
            )
            .order_by(
                (Achievement.moderator_id == user.id).desc(),
                Achievement.created_at.asc(),
            )
            .limit(1)
        )
        continue_stmt = _apply_staff_user_scope(continue_stmt, user)
        continue_achievement_id = await db.scalar(continue_stmt)

        moderation_category_stmt = _staff_scoped_achievement_stmt(
            select(Achievement.category, func.count().label('count')),
            user,
        ).filter(
            live_queue_condition,
            Achievement.status == AchievementStatus.PENDING,
        ).group_by(Achievement.category).order_by(desc('count'))
        moderation_category_rows = (await db.execute(moderation_category_stmt)).all()

        moderation_group_stmt = _staff_scoped_achievement_stmt(
            select(Users.study_group, func.count().label('count')),
            user,
        ).filter(
            live_queue_condition,
            Achievement.status == AchievementStatus.PENDING,
            Users.study_group.isnot(None),
        ).group_by(Users.study_group).order_by(desc('count'))
        moderation_group_rows = (await db.execute(moderation_group_stmt)).all()

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
                        season_condition,
                        Achievement.created_at >= previous_start,
                        Achievement.created_at < previous_end,
                    ).label('total'),
                    func.count().filter(
                        approved_condition,
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
                & approved_condition
                & (Achievement.created_at >= start_date)
                & (Achievement.created_at < end_date),
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
            .filter(season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date)
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
            .filter(season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date)
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
                season_condition,
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
                season_condition,
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
            .filter(season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date)
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
            'selected_season': season,
            'available_seasons': available_seasons,
            'date_from': start_date.date().isoformat(),
            'date_to': date_to or end_date.date().isoformat(),
            'new_users_count': int(new_users_count),
            'pending_achievements': int(ach_stats.pending or 0),
            'approved_achievements': int(ach_stats.approved or 0),
            'rejected_achievements': int(ach_stats.rejected or 0),
            'total_achievements': int(ach_stats.total or 0),
            'staff_queue': {
                'free': int(queue_stats.free or 0),
                'mine': int(queue_stats.mine or 0),
                'overdue': int(queue_stats.overdue or 0),
                'revision': int(queue_stats.revision or 0),
                'continue_achievement_id': continue_achievement_id,
                'received_today': int(today_stats.received or 0),
                'reviewed_today': int(today_stats.reviewed or 0),
                'average_review_seconds': int(today_stats.average_review_seconds or 0),
            },
            'current_season': {
                'id': live_season.id,
                'name': live_season.name,
                'status': live_season.status,
                'start_at': live_season.start_at.isoformat(),
                'submissions_open_at': live_season.submissions_open_at.isoformat(),
                'submissions_close_at': live_season.submissions_close_at.isoformat() if live_season.submissions_close_at else None,
                'moderation_close_at': live_season.moderation_close_at.isoformat() if live_season.moderation_close_at else None,
                'scoring_rules_version': live_season.scoring_rules_version,
                'participants': current_participants,
                'documents': int(ach_stats.total or 0),
                'approved': int(ach_stats.approved or 0),
                'pending': int(ach_stats.pending or 0),
            } if live_season else None,
            'moderation_load': {
                'categories': [
                    {
                        'label': row.category.value if hasattr(row.category, 'value') else str(row.category),
                        'count': int(row.count or 0),
                    }
                    for row in moderation_category_rows if row.category is not None
                ],
                'groups': [
                    {'label': str(row.study_group), 'count': int(row.count or 0)}
                    for row in moderation_group_rows if row.study_group
                ],
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
            approved_condition,
            Achievement.created_at >= start_date,
            Achievement.created_at < end_date,
        )
    )).scalar() or 0
    gpa_bonus = calculate_gpa_bonus(user.session_gpa) if include_gpa_bonus else 0
    my_points = int(achievement_points) + int(gpa_bonus)

    doc_stats = (await db.execute(
        select(
            func.count().filter(Achievement.user_id == user.id, season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date).label('total'),
            func.count().filter(Achievement.user_id == user.id, _achievement_effective_status(season, AchievementStatus.PENDING), Achievement.created_at >= start_date, Achievement.created_at < end_date).label('pending'),
            func.count().filter(Achievement.user_id == user.id, approved_condition, Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('approved'),
            func.count().filter(Achievement.user_id == user.id, _achievement_effective_status(season, AchievementStatus.REJECTED), Achievement.updated_at >= start_date, Achievement.updated_at < end_date).label('rejected'),
            func.count().filter(Achievement.user_id == user.id, _achievement_effective_status(season, AchievementStatus.REVISION)).label('revision'),
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
            & approved_condition
            & (Achievement.created_at >= start_date)
            & (Achievement.created_at < end_date),
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
        .filter(Achievement.user_id == user.id, season_condition, Achievement.created_at >= start_date, Achievement.created_at < end_date)
        .order_by(Achievement.created_at.desc())
        .limit(5)
    )).scalars().all()

    category_rows = (await db.execute(
        select(Achievement.category, func.sum(Achievement.points))
        .filter(
            Achievement.user_id == user.id,
            approved_condition,
            Achievement.created_at >= start_date,
            Achievement.created_at < end_date,
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
        'selected_season': season,
        'available_seasons': available_seasons,
        'date_from': start_date.date().isoformat(),
        'date_to': date_to or end_date.date().isoformat(),
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
