from __future__ import annotations

from datetime import datetime, timezone

import structlog

from app.config import settings
from app.models.enums import SupportTicketStatus
from app.models.support_message import SupportMessage
from app.models.support_ticket import SupportTicket
from app.repositories.admin.support_repository import SupportMessageRepository, SupportTicketRepository
from app.utils.file_validator import FileValidator, SUPPORT_SIGNATURES
from app.utils.support_crypto import encrypt_text
from app.utils.support_sessions import calculate_session_expiration

logger = structlog.get_logger()


class SupportService:
    def __init__(self, ticket_repo: SupportTicketRepository, message_repo: SupportMessageRepository):
        self.ticket_repo = ticket_repo
        self.message_repo = message_repo
        self.db = ticket_repo.db
        self._file_validator = FileValidator(
            allowed=SUPPORT_SIGNATURES,
            max_size=settings.MAX_SUPPORT_FILE_SIZE,
            upload_dir=settings.UPLOAD_DIR_SUPPORT,
        )

    async def create_ticket(self, user_id: int, subject: str, category: str = 'technical') -> SupportTicket:
        ticket = SupportTicket(
            user_id=user_id,
            moderator_id=None,
            subject=subject,
            category=category,
            status=SupportTicketStatus.OPEN,
            assigned_at=None,
            session_expires_at=None,
            closed_at=None,
            archived_at=None,
        )
        self.db.add(ticket)
        await self.db.commit()
        await self.db.refresh(ticket)
        return ticket

    async def create_ticket_with_initial_message(
        self,
        user_id: int,
        subject: str,
        text: str | None = None,
        file=None,
        category: str = 'technical',
    ) -> SupportTicket:
        clean_subject = (subject or "").strip()[:255]
        if not clean_subject:
            raise ValueError("Укажите тему обращения")

        clean_text = text.strip() if text and text.strip() else None
        if not clean_text and not (file and file.filename):
            raise ValueError("Сообщение должно содержать текст или файл")

        ticket = SupportTicket(
            user_id=user_id,
            moderator_id=None,
            subject=clean_subject,
            category=category,
            status=SupportTicketStatus.OPEN,
            assigned_at=None,
            session_expires_at=None,
            closed_at=None,
            archived_at=None,
            moderator_unread_count=1,
        )
        self.db.add(ticket)
        await self.db.flush()

        file_path = None
        if file and file.filename:
            file_path = await self._file_validator.validate_and_store(file, subdirectory=str(ticket.id), encrypt=True)

        if not clean_text and not file_path:
            raise ValueError("Сообщение должно содержать текст или файл")

        message = SupportMessage(
            ticket_id=ticket.id,
            sender_id=user_id,
            text=encrypt_text(clean_text),
            file_path=file_path,
            is_from_moderator=False,
        )
        self.db.add(message)
        await self.db.commit()
        await self.db.refresh(ticket)
        return ticket

    async def create_ticket_from_moderator(
        self,
        user_id: int,
        moderator_id: int,
        subject: str,
        text: str | None = None,
        file=None,
        session_duration: str | None = "month",
    ) -> SupportTicket:
        clean_subject = (subject or "").strip()[:255] or "Сообщение от модератора"
        clean_text = text.strip() if text and text.strip() else None
        if not clean_text and not (file and file.filename):
            raise ValueError("Сообщение должно содержать текст или файл")

        now = datetime.now(timezone.utc)
        ticket = SupportTicket(
            user_id=user_id,
            moderator_id=moderator_id,
            subject=clean_subject,
            status=SupportTicketStatus.IN_PROGRESS,
            assigned_at=now,
            session_expires_at=calculate_session_expiration(session_duration),
            closed_at=None,
            archived_at=None,
            student_unread_count=1,
        )
        self.db.add(ticket)
        await self.db.flush()

        file_path = None
        if file and file.filename:
            file_path = await self._file_validator.validate_and_store(file, subdirectory=str(ticket.id), encrypt=True)

        message = SupportMessage(
            ticket_id=ticket.id,
            sender_id=moderator_id,
            text=encrypt_text(clean_text),
            file_path=file_path,
            is_from_moderator=True,
        )
        self.db.add(message)
        await self.db.commit()
        await self.db.refresh(ticket)
        return ticket

    async def take_ticket(self, ticket_id: int, moderator_id: int) -> SupportTicket:
        ticket = await self.ticket_repo.find(ticket_id)
        if not ticket:
            raise ValueError("РћР±СЂР°С‰РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ")
        if ticket.archived_at:
            raise ValueError("РђСЂС…РёРІРЅРѕРµ РѕР±СЂР°С‰РµРЅРёРµ РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РґР»СЏ С‡С‚РµРЅРёСЏ")
        if ticket.moderator_id and ticket.moderator_id != moderator_id:
            raise ValueError("РћР±СЂР°С‰РµРЅРёРµ СѓР¶Рµ РїСЂРёРЅСЏС‚Рѕ РґСЂСѓРіРёРј РјРѕРґРµСЂР°С‚РѕСЂРѕРј")
        if ticket.status == SupportTicketStatus.CLOSED:
            raise ValueError("Р—Р°РєСЂС‹С‚РѕРµ РѕР±СЂР°С‰РµРЅРёРµ РЅСѓР¶РЅРѕ СЃРЅР°С‡Р°Р»Р° РїРµСЂРµРѕС‚РєСЂС‹С‚СЊ")

        now = datetime.now(timezone.utc)
        ticket.moderator_id = moderator_id
        ticket.assigned_at = ticket.assigned_at or now
        ticket.updated_at = now
        if ticket.status == SupportTicketStatus.OPEN:
            ticket.status = SupportTicketStatus.IN_PROGRESS

        await self.db.commit()
        await self.db.refresh(ticket)
        return ticket

    async def send_message(
        self,
        ticket_id: int,
        sender_id: int,
        text: str = None,
        file=None,
        is_from_moderator: bool = False,
        session_duration: str | None = None,
        reply_to_id: int | None = None,
    ) -> SupportMessage:
        ticket = await self.ticket_repo.find(ticket_id)
        if not ticket:
            raise ValueError("Обращение не найдено")
        if ticket.archived_at:
            raise ValueError("Архивное обращение доступно только для чтения")
        if ticket.status == SupportTicketStatus.CLOSED:
            if is_from_moderator:
                raise ValueError("Сначала откройте обращение снова")
            raise ValueError("Обращение закрыто")
        if is_from_moderator and ticket.moderator_id and ticket.moderator_id != sender_id:
            raise ValueError("Обращение уже принято другим модератором")

        clean_text = text.strip() if text and text.strip() else None
        file_path = None
        if file and file.filename:
            file_path = await self._file_validator.validate_and_store(file, subdirectory=str(ticket_id), encrypt=True)

        if not clean_text and not file_path:
            raise ValueError("Сообщение должно содержать текст или файл")

        message = SupportMessage(
            ticket_id=ticket_id,
            sender_id=sender_id,
            text=encrypt_text(clean_text),
            file_path=file_path,
            is_from_moderator=is_from_moderator,
            reply_to_id=reply_to_id,
        )
        self.db.add(message)

        now = datetime.now(timezone.utc)
        ticket.updated_at = now
        if is_from_moderator:
            ticket.student_unread_count = int(getattr(ticket, 'student_unread_count', 0) or 0) + 1
            if ticket.moderator_id is None:
                ticket.moderator_id = sender_id
                ticket.assigned_at = now
            if ticket.status == SupportTicketStatus.OPEN:
                ticket.status = SupportTicketStatus.IN_PROGRESS
            ticket.closed_at = None
            ticket.session_expires_at = calculate_session_expiration(session_duration)
        else:
            ticket.moderator_unread_count = int(getattr(ticket, 'moderator_unread_count', 0) or 0) + 1

        await self.db.commit()
        await self.db.refresh(message)
        return message

    async def close_ticket(self, ticket_id: int, resolution: str | None = None):
        ticket = await self.ticket_repo.find(ticket_id)
        if not ticket:
            return None
        if ticket.archived_at:
            raise ValueError("Архивное обращение нельзя изменять")

        now = datetime.now(timezone.utc)
        ticket.status = SupportTicketStatus.CLOSED
        ticket.closed_at = now
        ticket.session_expires_at = None
        ticket.updated_at = now
        ticket.resolution = resolution
        await self.db.commit()
        return ticket

    async def reopen_ticket(self, ticket_id: int, session_duration: str | None = None):
        ticket = await self.ticket_repo.find(ticket_id)
        if not ticket:
            return None
        if ticket.archived_at:
            raise ValueError("Архивное обращение нельзя переоткрыть")

        now = datetime.now(timezone.utc)
        ticket.status = SupportTicketStatus.OPEN
        ticket.closed_at = None
        ticket.session_expires_at = calculate_session_expiration(session_duration)
        ticket.updated_at = now
        await self.db.commit()
        return ticket
