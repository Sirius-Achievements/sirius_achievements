from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementStatus, SupportTicketStatus, UserRole, UserStatus
from app.models.support_ticket import SupportTicket
from app.models.user import Users
from app.utils.points import aggregated_gpa_bonus_expr

router = APIRouter(prefix='/api/v1/reports', tags=['api.v1.reports'])


class ReportExportPayload(BaseModel):
    period: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    education_level: str | None = None
    course: str | None = None
    group: str | None = None
    student_id: int | None = None
    student_ids: list[int] | None = None
    category: str | None = None
    status: str | None = None


def _parse_date(value: str | None, *, end: bool = False):
    if not value:
        return None
    parsed = datetime.strptime(value, '%Y-%m-%d')
    return parsed + timedelta(days=1) if end else parsed


def _period_dates(period: str | None):
    now = datetime.now()
    if period == 'day':
        return now - timedelta(days=1), now + timedelta(days=1)
    if period == 'week':
        return now - timedelta(days=7), now + timedelta(days=1)
    if period == 'month':
        return now - timedelta(days=30), now + timedelta(days=1)
    return None, None


def _apply_date(stmt, column, date_from: str | None, date_to: str | None, period: str | None = None):
    period_start, period_end = _period_dates(period)
    start = _parse_date(date_from) or period_start
    end = _parse_date(date_to, end=True) or period_end
    if start:
        stmt = stmt.filter(column >= start)
    if end:
        stmt = stmt.filter(column < end)
    return stmt


def _csv_response(rows: list[list[object]], filename: str):
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerows(rows)
    output.seek(0)
    return Response(
        content='\ufeff' + output.getvalue(),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}'},
    )


def _scope_users(stmt, current_user, education_level: str | None, course: str | None, group: str | None):
    if current_user.role == UserRole.MODERATOR:
        if current_user.education_level:
            stmt = stmt.filter(Users.education_level == current_user.education_level)
        if current_user.moderator_courses:
            courses = [int(item) for item in current_user.moderator_courses.split(',') if item.isdigit()]
            if courses:
                stmt = stmt.filter(Users.course.in_(courses))
        if current_user.moderator_groups:
            groups = [item.strip() for item in current_user.moderator_groups.split(',') if item.strip()]
            if groups:
                stmt = stmt.filter(Users.study_group.in_(groups))
    elif education_level and education_level != 'all':
        stmt = stmt.filter(Users.education_level == education_level)

    if course and course != '0' and course.isdigit():
        stmt = stmt.filter(Users.course == int(course))
    if group and group != 'all':
        stmt = stmt.filter(Users.study_group == group)
    return stmt


def _selected_student_ids(student_id: int | None, student_ids: list[int] | None) -> list[int]:
    values: list[int] = []
    if student_id is not None:
        values.append(student_id)
    if student_ids:
        values.extend(student_ids)
    return list(dict.fromkeys(values))


async def _require_staff(current_user=Depends(auth)):
    if current_user.role not in {UserRole.MODERATOR, UserRole.SUPER_ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Экспорт доступен только сотрудникам.')
    return current_user


@router.post('/{report_type}/export')
async def export_report_post(
    report_type: str,
    payload: ReportExportPayload,
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    return await export_report(
        report_type=report_type,
        period=payload.period,
        date_from=payload.date_from,
        date_to=payload.date_to,
        education_level=payload.education_level,
        course=payload.course,
        group=payload.group,
        student_id=payload.student_id,
        student_ids=payload.student_ids,
        category=payload.category,
        status_filter=payload.status,
        current_user=current_user,
        db=db,
    )


@router.get('/{report_type}')
async def export_report(
    report_type: str,
    period: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    education_level: str | None = Query(default=None),
    course: str | None = Query(default=None),
    group: str | None = Query(default=None),
    student_id: int | None = Query(default=None),
    student_ids: list[int] | None = Query(default=None),
    category: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias='status'),
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    selected_student_ids = _selected_student_ids(student_id, student_ids)
    if report_type in {'moderation', 'documents'}:
        stmt = (
            select(Achievement, Users)
            .join(Users, Achievement.user_id == Users.id)
            .order_by(Achievement.created_at.desc())
        )
        if report_type == 'moderation':
            stmt = stmt.filter(Achievement.status == AchievementStatus.PENDING)
        if status_filter and status_filter != 'all':
            stmt = stmt.filter(Achievement.status == status_filter)
        if category and category != 'all':
            stmt = stmt.filter(Achievement.category == category)
        if selected_student_ids:
            stmt = stmt.filter(Achievement.user_id.in_(selected_student_ids))
        stmt = _apply_date(stmt, Achievement.created_at, date_from, date_to, period)
        stmt = _scope_users(stmt, current_user, education_level, course, group)
        rows = (await db.execute(stmt)).all()
        csv_rows = [['ID', 'Документ', 'Студент', 'Email', 'Статус', 'Категория', 'Уровень', 'Результат', 'Баллы', 'Курс', 'Группа', 'Дата']]
        for achievement, student in rows:
            csv_rows.append([
                achievement.id,
                achievement.title,
                f'{student.first_name} {student.last_name}',
                student.email,
                achievement.status.value if hasattr(achievement.status, 'value') else achievement.status,
                achievement.category.value if achievement.category else '',
                achievement.level.value if achievement.level else '',
                achievement.result.value if achievement.result else '',
                int(achievement.points or 0),
                student.course or '',
                student.study_group or '',
                achievement.created_at.strftime('%d.%m.%Y') if achievement.created_at else '',
            ])
        return _csv_response(csv_rows, f'{report_type}_report.csv')

    if report_type in {'leaderboard', 'students'}:
        achievement_points = func.coalesce(func.sum(Achievement.points), 0)
        total_points = (achievement_points + aggregated_gpa_bonus_expr(Users.session_gpa)).label('total_points')
        stmt = (
            select(Users, total_points, func.count(Achievement.id).label('docs_count'))
            .outerjoin(Achievement, (Users.id == Achievement.user_id) & (Achievement.status == AchievementStatus.APPROVED))
            .filter(Users.role == UserRole.STUDENT, Users.status == UserStatus.ACTIVE)
            .group_by(Users.id)
            .order_by(desc('total_points'), desc('docs_count'))
        )
        if selected_student_ids:
            stmt = stmt.filter(Users.id.in_(selected_student_ids))
        stmt = _scope_users(stmt, current_user, education_level, course, group)
        rows = (await db.execute(stmt)).all()
        csv_rows = [['Место', 'Имя', 'Фамилия', 'Email', 'Обучение', 'Курс', 'Группа', 'Баллы', 'Документов']]
        for index, (student, points, docs_count) in enumerate(rows, 1):
            csv_rows.append([
                index,
                student.first_name,
                student.last_name,
                student.email,
                student.education_level.value if student.education_level else '',
                student.course or '',
                student.study_group or '',
                int(points or 0),
                int(docs_count or 0),
            ])
        return _csv_response(csv_rows, f'{report_type}_report.csv')

    if report_type in {'groups', 'streams', 'aggregate', 'categories'}:
        columns = [
            Users.education_level.label('education_level'),
            Users.course.label('course'),
            Users.study_group.label('study_group'),
            Achievement.category.label('category'),
            func.count(Achievement.id).label('docs_count'),
            func.coalesce(func.sum(Achievement.points), 0).label('points'),
            func.count(Achievement.id).filter(Achievement.status == AchievementStatus.PENDING).label('pending'),
            func.count(Achievement.id).filter(Achievement.status == AchievementStatus.APPROVED).label('approved'),
            func.count(Achievement.id).filter(Achievement.status == AchievementStatus.REJECTED).label('rejected'),
        ]
        stmt = select(*columns).join(Users, Achievement.user_id == Users.id)
        stmt = _apply_date(stmt, Achievement.created_at, date_from, date_to, period)
        stmt = _scope_users(stmt, current_user, education_level, course, group)
        if selected_student_ids:
            stmt = stmt.filter(Users.id.in_(selected_student_ids))
        if report_type == 'groups':
            stmt = stmt.group_by(Users.education_level, Users.course, Users.study_group, Achievement.category)
        elif report_type == 'streams':
            stmt = stmt.group_by(Users.education_level, Users.course, Achievement.category)
        elif report_type == 'categories':
            stmt = stmt.group_by(Users.education_level, Achievement.category)
        else:
            stmt = stmt.group_by(Users.education_level, Users.course, Users.study_group, Achievement.category)
        rows = (await db.execute(stmt)).all()
        csv_rows = [['Обучение', 'Курс', 'Группа', 'Категория', 'Документов', 'Баллы', 'Ожидают', 'Одобрено', 'Отклонено']]
        for row in rows:
            csv_rows.append([
                row.education_level.value if row.education_level else '',
                row.course or '',
                row.study_group or '',
                row.category.value if row.category else '',
                int(row.docs_count or 0),
                int(row.points or 0),
                int(row.pending or 0),
                int(row.approved or 0),
                int(row.rejected or 0),
            ])
        return _csv_response(csv_rows, f'{report_type}_report.csv')

    if report_type == 'support':
        stmt = select(SupportTicket, Users).join(Users, SupportTicket.user_id == Users.id).order_by(SupportTicket.created_at.desc())
        stmt = _apply_date(stmt, SupportTicket.created_at, date_from, date_to, period)
        stmt = _scope_users(stmt, current_user, education_level, course, group)
        if selected_student_ids:
            stmt = stmt.filter(SupportTicket.user_id.in_(selected_student_ids))
        rows = (await db.execute(stmt)).all()
        csv_rows = [['ID', 'Тема', 'Студент', 'Email', 'Статус', 'Курс', 'Группа', 'Создано', 'Обновлено']]
        for ticket, student in rows:
            csv_rows.append([
                ticket.id,
                ticket.subject,
                f'{student.first_name} {student.last_name}',
                student.email,
                ticket.status.value if hasattr(ticket.status, 'value') else ticket.status,
                student.course or '',
                student.study_group or '',
                ticket.created_at.strftime('%d.%m.%Y %H:%M') if ticket.created_at else '',
                ticket.updated_at.strftime('%d.%m.%Y %H:%M') if ticket.updated_at else '',
            ])
        return _csv_response(csv_rows, 'support_report.csv')

    raise HTTPException(status_code=404, detail='Неизвестный тип отчёта.')
