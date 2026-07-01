from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.repositories.admin.support_repository import SupportMessageRepository, SupportTicketRepository
from app.services.admin.support_service import SupportService
from app.utils.access import is_in_zone
from app.utils.media_paths import guess_media_type, resolve_static_path
from app.utils import storage
from app.utils.notifications import broadcast_staff_event

from .serializers import serialize_support_message, serialize_support_ticket

router = APIRouter(prefix='/api/v1/support', tags=['api.v1.support'])


def get_support_service(db: AsyncSession = Depends(get_db)):
    ticket_repo = SupportTicketRepository(db)
    message_repo = SupportMessageRepository(db)
    return SupportService(ticket_repo, message_repo)


def _can_access_ticket(user, ticket) -> bool:
    if not user or not ticket:
        return False
    if ticket.user_id == user.id:
        return True
    ticket_user = getattr(ticket, 'user', None)
    return is_in_zone(
        user,
        getattr(ticket_user, 'education_level', None),
        getattr(ticket_user, 'course', None),
        getattr(ticket_user, 'study_group', None),
    )


async def _inline_file_response(relative_path: str) -> FileResponse | StreamingResponse:
    from app.utils.support_crypto import decrypt_bytes

    is_encrypted = relative_path.endswith('.enc')

    if storage.is_minio_path(relative_path):
        key = storage.extract_key(relative_path)
        try:
            data = await storage.download(key)
        except Exception as exc:
            raise HTTPException(status_code=404, detail='File not found') from exc
        if is_encrypted:
            data = decrypt_bytes(data)
        filename = key.rsplit('/', 1)[-1]
        if is_encrypted and filename.endswith('.enc'):
            filename = filename[:-4]
        return StreamingResponse(
            io.BytesIO(data),
            media_type=guess_media_type(filename),
            headers={'Content-Disposition': f'inline; filename="{filename}"'},
        )

    try:
        full_path = resolve_static_path(relative_path)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail='Invalid file path') from exc

    if not full_path.exists():
        raise HTTPException(status_code=404, detail='File not found')

    if is_encrypted:
        data = decrypt_bytes(full_path.read_bytes())
        filename = full_path.name[:-4] if full_path.name.endswith('.enc') else full_path.name
        return StreamingResponse(
            io.BytesIO(data),
            media_type=guess_media_type(filename),
            headers={'Content-Disposition': f'inline; filename="{filename}"'},
        )

    response = FileResponse(path=full_path, media_type=guess_media_type(full_path))
    response.headers['Content-Disposition'] = f'inline; filename="{full_path.name}"'
    return response


@router.get('')
@router.get('/')
async def list_tickets(
    view: str = Query(default='active'),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    tickets = await ticket_repo.get_by_user(current_user.id, view=view)
    return {
        'tickets': [serialize_support_ticket(ticket) for ticket in tickets],
        'total': len(tickets),
        'view': view,
    }


@router.post('')
@router.post('/')
async def create_ticket(
    subject: str = Form(..., min_length=1, max_length=200),
    message: str = Form(..., min_length=1, max_length=5000),
    file: UploadFile | None = File(default=None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    try:
        ticket = await service.create_ticket_with_initial_message(
            user_id=current_user.id,
            subject=subject,
            text=message,
            file=file if file and file.filename else None,
        )
        await broadcast_staff_event(
            db,
            'support_queue_updated',
            {'ticket_id': ticket.id, 'action': 'created'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось создать обращение. Проверьте данные и повторите попытку.') from exc

    ticket = await SupportTicketRepository(db).find_with_messages(ticket.id)
    return {'ticket': serialize_support_ticket(ticket, include_messages=True)}


@router.get('/{ticket_id}')
async def get_ticket(
    ticket_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or ticket.user_id != current_user.id:
        raise HTTPException(status_code=404, detail='Ticket not found')

    return {
        'ticket': serialize_support_ticket(ticket, include_messages=True),
        'messages': [serialize_support_message(message) for message in ticket.messages],
    }


@router.post('/{ticket_id}/send')
async def send_message(
    ticket_id: int,
    text: str | None = Form(default=None, max_length=5000),
    file: UploadFile | None = File(default=None),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
    service: SupportService = Depends(get_support_service),
):
    ticket_repo = SupportTicketRepository(db)
    ticket = await ticket_repo.find_with_messages(ticket_id)
    if not ticket or ticket.user_id != current_user.id:
        raise HTTPException(status_code=404, detail='Ticket not found')

    try:
        message = await service.send_message(
            ticket_id=ticket_id,
            sender_id=current_user.id,
            text=text,
            file=file if file and file.filename else None,
            is_from_moderator=False,
        )
        await broadcast_staff_event(
            db,
            'support_queue_updated',
            {'ticket_id': ticket_id, 'action': 'student_reply'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Не удалось отправить сообщение. Проверьте данные и повторите попытку.') from exc

    updated_ticket = await ticket_repo.find_with_messages(ticket_id)
    return {
        'message': serialize_support_message(message),
        'ticket': serialize_support_ticket(updated_ticket, include_messages=True),
    }


@router.get('/messages/{message_id}/attachment')
async def get_attachment(
    message_id: int,
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    message_repo = SupportMessageRepository(db)
    message = await message_repo.find_with_ticket(message_id)
    if not message or not message.file_path:
        raise HTTPException(status_code=404, detail='Attachment not found')
    if not _can_access_ticket(current_user, message.ticket):
        raise HTTPException(status_code=403, detail='Access denied')

    return await _inline_file_response(message.file_path)
