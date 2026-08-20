from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.enums import SupportTicketStatus, UserRole
from app.models.support_ticket import SupportTicket
from app.models.support_message import SupportMessage
from app.models.user import Users
from app.repositories.admin.support_repository import SupportTicketRepository
from app.services.admin.support_service import SupportService
from app.services.ws_manager import ws_manager
from app.utils.access import is_in_zone
from app.utils.notifications import broadcast_staff_event, make_notification, serialize_notification
from app.utils.search import escape_like

from .serializers import serialize_support_message, serialize_support_ticket

router = APIRouter(prefix='/api/v1/moderation/support', tags=['api.v1.moderation.support'])


class ReopenPayload(BaseModel):
    session_duration: str | None = 'month'


class ClosePayload(BaseModel):
    resolution: str


def get_support_service(db: AsyncSession = Depends(get_db)):
    ticket_repo = SupportTicketRepository(db)
    from app.repositories.admin.support_repository import SupportMessageRepository

    message_repo = SupportMessageRepository(db)
    return SupportService(ticket_repo, message_repo)


async def require_moderator(current_user=Depends(auth)):
    if current_user.role not in {UserRole.MODERATOR, UserRole.SUPER_ADMIN}:
        raise HTTPException(status_code=403, detail='Access denied')
    return current_user


def _moderator_zone(user):
    if user.role != UserRole.MODERATOR:
        return None, None, None
    return user.education_level, getattr(user, 'moderator_courses', None), getattr(user, 'moderator_groups', None)


def _can_access_ticket(user, ticket) -> bool:
    ticket_user = getattr(ticket, 'user', None)
    return bool(ticket and is_in_zone(
        user,
        getattr(ticket_user, 'education_level', None),
        getattr(ticket_user, 'course', None),
        getattr(ticket_user, 'study_group', None),
    ))


def _can_manage_ticket(user, ticket) -> bool:
    if not _can_access_ticket(user, ticket):
        return False
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if ticket.moderator_id is None:
        return True
    return ticket.moderator_id == user.id


async def _support_queue_stats(db: AsyncSession, current_user) -> dict[str, int]:
    """Return shared queue counters within the moderator's access zone."""
    stmt = select(SupportTicket).join(Users, SupportTicket.user_id == Users.id).filter(
        SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
        SupportTicket.archived_at.is_(None),
    )
    education_level, courses, groups = _moderator_zone(current_user)
    if education_level is not None:
        stmt = stmt.filter(Users.education_level == education_level)
    if courses:
        course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
        if course_values:
            stmt = stmt.filter(Users.course.in_(course_values))
    if groups:
        group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
        if group_values:
            stmt = stmt.filter(Users.study_group.in_(group_values))

    tickets = (await db.execute(stmt)).scalars().all()
    overdue_before = datetime.now(timezone.utc) - timedelta(hours=48)

    def normalized(value):
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    return {
        'active': len(tickets),
        'free': sum(1 for ticket in tickets if ticket.moderator_id is None),
        'mine': sum(1 for ticket in tickets if ticket.moderator_id == current_user.id),
        'overdue': sum(
            1
            for ticket in tickets
            if normalized(ticket.assigned_at or ticket.created_at) < overdue_before
        ),
    }


async def _notify_support_user(db: AsyncSession, user_id: int, title: str, message: str, link: str):
    notification = make_notification(user_id=user_id, title=title, message=message, link=link)
    db.add(notification)
    await db.commit()
    await ws_manager.send_to_user(
        user_id,
        {'type': 'notification', 'notification': serialize_notification(notification)},
    )


@router.get('')
@router.get('/')
async def moderation_support_queue(
    page: int = Query(default=1, ge=1, le=1000),
    query: str = '',
    sort_by: str = 'created_at',
    sort_order: str = 'desc',
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    education_level, courses, groups = _moderator_zone(current_user)
    tickets = await ticket_repo.get_new_tickets(
        page,
        education_level=education_level,
        courses=courses,
        groups=groups,
        query=query,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    total = await ticket_repo.count_new_tickets(education_level=education_level, courses=courses, groups=groups, query=query)
    total_pages = math.ceil(total / settings.SUPPORT_ITEMS_PER_PAGE) if total > 0 else 1
    return {
        'tickets': [serialize_support_ticket(ticket) for ticket in tickets],
        'page': page,
        'total_pages': total_pages,
        'total': int(total or 0),
        'view': 'new',
        'stats': await _support_queue_stats(db, current_user),
    }


@router.get('/chats')
async def moderation_support_chats(
    page: int = Query(default=1, ge=1, le=1000),
    status: str = '',
    statuses: list[str] | None = Query(default=None),
    status_logic: str = 'or',
    query: str = '',
    sort_by: str = 'updated_at',
    sort_order: str = 'desc',
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    filters = {'page': page, 'status_logic': status_logic}
    if statuses:
        filters['statuses'] = statuses
    elif status:
        filters['status'] = status
    if query:
        filters['query'] = query

    tickets = await ticket_repo.get_all_tickets(filters, sort_by, sort_order, education_level=None, assigned_to_id=current_user.id)
    total = await ticket_repo.count_all_tickets(filters, education_level=None, assigned_to_id=current_user.id)
    total_pages = math.ceil(total / settings.SUPPORT_ITEMS_PER_PAGE) if total > 0 else 1
    return {
        'tickets': [serialize_support_ticket(ticket) for ticket in tickets],
        'page': page,
        'total_pages': total_pages,
        'total': int(total or 0),
        'view': 'chats',
        'stats': await _support_queue_stats(db, current_user),
    }


@router.get('/search')
async def search_support_tickets(
    q: str = Query(..., min_length=1),
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    like_term = f"%{escape_like(q)}%"
    stmt = (
        select(SupportTicket)
        .join(Users, SupportTicket.user_id == Users.id)
        .filter(
            or_(
                SupportTicket.subject.ilike(like_term),
                Users.first_name.ilike(like_term),
                Users.last_name.ilike(like_term),
                Users.email.ilike(like_term),
                (Users.first_name + ' ' + Users.last_name).ilike(like_term),
            )
        )
    )
    education_level, courses, groups = _moderator_zone(current_user)
    if education_level is not None:
        stmt = stmt.filter(Users.education_level == education_level)
    if courses:
        course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
        if course_values:
            stmt = stmt.filter(Users.course.in_(course_values))
    if groups:
        group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
        if group_values:
            stmt = stmt.filter(Users.study_group.in_(group_values))
    stmt = stmt.order_by(SupportTicket.created_at.desc()).limit(7)
    tickets = (await db.execute(stmt)).scalars().all()
    return [{'value': ticket.subject, 'text': f'#{ticket.id} - {ticket.subject}'} for ticket in tickets]


@router.get('/all')
async def moderation_support_all(
    page: int = Query(default=1, ge=1, le=1000),
    status: str = '',
    statuses: list[str] | None = Query(default=None),
    status_logic: str = 'or',
    query: str = '',
    sort_by: str = 'created_at',
    sort_order: str = 'desc',
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    filters = {'page': page, 'status_logic': status_logic}
    if statuses:
        filters['statuses'] = statuses
    elif status:
        filters['status'] = status
    if query:
        filters['query'] = query

    education_level, courses, groups = _moderator_zone(current_user)
    tickets = await ticket_repo.get_all_tickets(filters, sort_by, sort_order, education_level=education_level, courses=courses, groups=groups)
    total = await ticket_repo.count_all_tickets(filters, education_level=education_level, courses=courses, groups=groups)
    total_pages = math.ceil(total / settings.SUPPORT_ITEMS_PER_PAGE) if total > 0 else 1
    return {
        'tickets': [serialize_support_ticket(ticket) for ticket in tickets],
        'page': page,
        'total_pages': total_pages,
        'total': int(total or 0),
        'view': 'all',
        'stats': await _support_queue_stats(db, current_user),
    }


@router.get('/{ticket_id}')
async def moderation_support_chat(
    ticket_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)

    if not ticket:
        raise HTTPException(status_code=404, detail='Ticket not found')
    if not _can_access_ticket(current_user, ticket):
        raise HTTPException(status_code=403, detail='Access denied')

    if ticket.moderator_unread_count:
        ticket.moderator_unread_count = 0
        await db.commit()

    return {
        'ticket': serialize_support_ticket(ticket, include_messages=True),
        'messages': [serialize_support_message(message) for message in ticket.messages],
        'can_manage_ticket': _can_manage_ticket(current_user, ticket),
        'can_take_ticket': ticket.moderator_id is None and _can_manage_ticket(current_user, ticket),
        'is_my_ticket': ticket.moderator_id == current_user.id,
    }


@router.post('/{ticket_id}/take')
async def take_ticket(
    ticket_id: int,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or not _can_access_ticket(current_user, ticket):
        raise HTTPException(status_code=404, detail='Ticket not found')

    try:
        await service.take_ticket(ticket_id, current_user.id)
        await _notify_support_user(
            db,
            ticket.user_id,
            'Обращение взято в работу',
            f'Модератор начал работу с обращением «{ticket.subject}».',
            f'/sirius.achievements/app/support/{ticket_id}',
        )
        await broadcast_staff_event(db, 'support_queue_updated', {'ticket_id': ticket_id, 'action': 'taken'})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось принять обращение в работу.') from exc

    updated_ticket = await ticket_repo.find_with_messages(ticket_id)
    return {'success': True, 'ticket': serialize_support_ticket(updated_ticket, include_messages=True)}


@router.post('/{ticket_id}/send')
async def send_moderator_message(
    ticket_id: int,
    text: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    session_duration: str = Form(default='month'),
    reply_to_id: int | None = Form(default=None),
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or not _can_access_ticket(current_user, ticket):
        raise HTTPException(status_code=404, detail='Ticket not found')
    if not _can_manage_ticket(current_user, ticket):
        raise HTTPException(status_code=409, detail='Ticket is already assigned to another moderator')
    if reply_to_id is not None:
        reply_to = await db.get(SupportMessage, reply_to_id)
        if not reply_to or reply_to.ticket_id != ticket_id:
            raise HTTPException(status_code=400, detail='Цитируемое сообщение не найдено в этом обращении.')

    try:
        message = await service.send_message(
            ticket_id=ticket_id,
            sender_id=current_user.id,
            text=text,
            file=file if file and file.filename else None,
            is_from_moderator=True,
            session_duration=session_duration,
            reply_to_id=reply_to_id,
        )
        await _notify_support_user(
            db,
            ticket.user_id,
            'Новый ответ поддержки',
            f'Модератор ответил в обращении «{ticket.subject}».',
            f'/sirius.achievements/app/support/{ticket_id}',
        )
        await broadcast_staff_event(db, 'support_queue_updated', {'ticket_id': ticket_id, 'action': 'moderator_reply'})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось отправить сообщение.') from exc

    updated_ticket = await ticket_repo.find_with_messages(ticket_id)
    return {
        'message': serialize_support_message(message),
        'ticket': serialize_support_ticket(updated_ticket, include_messages=True),
    }


@router.post('/{ticket_id}/close')
async def close_ticket(
    ticket_id: int,
    payload: ClosePayload,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or not _can_access_ticket(current_user, ticket):
        raise HTTPException(status_code=404, detail='Ticket not found')
    if not _can_manage_ticket(current_user, ticket):
        raise HTTPException(status_code=409, detail='Ticket is already assigned to another moderator')

    try:
        if payload.resolution not in {'resolved', 'product_bug', 'document_question', 'duplicate'}:
            raise HTTPException(status_code=400, detail='Выберите результат закрытия.')
        await service.close_ticket(ticket_id, resolution=payload.resolution)
        await _notify_support_user(
            db,
            ticket.user_id,
            'Обращение закрыто',
            f'Модератор закрыл обращение «{ticket.subject}».',
            f'/sirius.achievements/app/support/{ticket_id}',
        )
        await broadcast_staff_event(db, 'support_queue_updated', {'ticket_id': ticket_id, 'action': 'closed'})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось закрыть обращение.') from exc

    updated_ticket = await ticket_repo.find_with_messages(ticket_id)
    return {'success': True, 'ticket': serialize_support_ticket(updated_ticket, include_messages=True)}


@router.post('/{ticket_id}/reopen')
async def reopen_ticket(
    ticket_id: int,
    payload: ReopenPayload,
    current_user=Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or not _can_access_ticket(current_user, ticket):
        raise HTTPException(status_code=404, detail='Ticket not found')
    if not _can_manage_ticket(current_user, ticket):
        raise HTTPException(status_code=409, detail='Ticket is already assigned to another moderator')

    try:
        await service.reopen_ticket(ticket_id, session_duration=payload.session_duration)
        await _notify_support_user(
            db,
            ticket.user_id,
            'Обращение открыто повторно',
            f'Модератор снова открыл обращение «{ticket.subject}».',
            f'/sirius.achievements/app/support/{ticket_id}',
        )
        await broadcast_staff_event(db, 'support_queue_updated', {'ticket_id': ticket_id, 'action': 'reopened'})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось переоткрыть обращение.') from exc

    updated_ticket = await ticket_repo.find_with_messages(ticket_id)
    return {'success': True, 'ticket': serialize_support_ticket(updated_ticket, include_messages=True)}
