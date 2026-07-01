import asyncio
from datetime import datetime, timedelta, timezone
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))
sys.modules.setdefault("structlog", types.SimpleNamespace(get_logger=lambda: types.SimpleNamespace()))

if "fastapi" not in sys.modules:
    fastapi_module = types.ModuleType("fastapi")

    class UploadFile:
        def __init__(self, *args, **kwargs):
            pass

    fastapi_module.UploadFile = UploadFile
    sys.modules["fastapi"] = fastapi_module

if "aiofiles" not in sys.modules:
    aiofiles_stub = types.ModuleType("aiofiles")

    class _AsyncOpen:
        async def __aenter__(self):
            raise RuntimeError("aiofiles.open should not be used in these unit tests")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    aiofiles_stub.open = lambda *args, **kwargs: _AsyncOpen()
    sys.modules["aiofiles"] = aiofiles_stub

if "app.models.support_message" not in sys.modules:
    support_message_module = types.ModuleType("app.models.support_message")

    class SupportMessage:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    support_message_module.SupportMessage = SupportMessage
    sys.modules["app.models.support_message"] = support_message_module

if "app.models.support_ticket" not in sys.modules:
    support_ticket_module = types.ModuleType("app.models.support_ticket")

    class SupportTicket:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    support_ticket_module.SupportTicket = SupportTicket
    sys.modules["app.models.support_ticket"] = support_ticket_module

if "app.repositories.admin.support_repository" not in sys.modules:
    support_repo_module = types.ModuleType("app.repositories.admin.support_repository")
    support_repo_module.SupportTicketRepository = object
    support_repo_module.SupportMessageRepository = object
    sys.modules["app.repositories.admin.support_repository"] = support_repo_module

from app.models.enums import SupportTicketStatus
from app.services.admin.support_service import SupportService


@pytest.fixture
def support_service():
    async def flush_side_effect():
        if not db.add.call_args_list:
            return
        first_obj = db.add.call_args_list[0].args[0]
        if getattr(first_obj, "id", None) is None:
            first_obj.id = 101

    db = SimpleNamespace(
        add=MagicMock(),
        commit=AsyncMock(),
        flush=AsyncMock(side_effect=flush_side_effect),
        refresh=AsyncMock(),
    )
    ticket_repo = SimpleNamespace(find=AsyncMock(), db=db)
    message_repo = SimpleNamespace()
    service = SupportService(ticket_repo=ticket_repo, message_repo=message_repo)
    return service, ticket_repo, db


def make_ticket(**overrides):
    base = dict(
        id=17,
        status=SupportTicketStatus.OPEN,
        archived_at=None,
        closed_at=None,
        updated_at=None,
        session_expires_at=None,
        moderator_id=None,
        assigned_at=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_create_ticket_with_initial_message_is_atomic(support_service):
    service, _, db = support_service

    ticket = asyncio.run(
        service.create_ticket_with_initial_message(
            user_id=5,
            subject="  Нужна помощь  ",
            text="  Есть вопрос  ",
        )
    )

    assert ticket.subject == "Нужна помощь"
    db.flush.assert_awaited_once()
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(ticket)
    assert db.add.call_count == 2


def test_create_ticket_with_initial_message_rejects_empty_payload_without_commit(support_service):
    service, _, db = support_service

    with pytest.raises(ValueError):
        asyncio.run(
            service.create_ticket_with_initial_message(
                user_id=5,
                subject="  Нужна помощь  ",
                text="   ",
            )
        )

    db.flush.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_take_ticket_assigns_moderator_and_moves_ticket_to_in_progress(support_service):
    service, ticket_repo, db = support_service
    ticket = make_ticket()
    ticket_repo.find.return_value = ticket

    taken = asyncio.run(service.take_ticket(ticket_id=17, moderator_id=44))

    assert taken is ticket
    assert ticket.moderator_id == 44
    assert ticket.assigned_at is not None
    assert ticket.status == SupportTicketStatus.IN_PROGRESS
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(ticket)


def test_take_ticket_rejects_foreign_assignment(support_service):
    service, ticket_repo, _ = support_service
    ticket_repo.find.return_value = make_ticket(moderator_id=99, assigned_at=datetime.now(timezone.utc))

    with pytest.raises(ValueError):
        asyncio.run(service.take_ticket(ticket_id=17, moderator_id=44))


def test_moderator_message_auto_assigns_ticket_and_sets_expiration(support_service):
    service, ticket_repo, db = support_service
    ticket = make_ticket()
    ticket_repo.find.return_value = ticket

    message = asyncio.run(
        service.send_message(
            ticket_id=5,
            sender_id=11,
            text="Ответ модератора",
            is_from_moderator=True,
            session_duration="week",
        )
    )

    assert message.is_from_moderator is True
    assert ticket.moderator_id == 11
    assert ticket.assigned_at is not None
    assert ticket.status == SupportTicketStatus.IN_PROGRESS
    assert ticket.session_expires_at is not None
    assert ticket.session_expires_at > datetime.now(timezone.utc) + timedelta(days=6)
    db.commit.assert_awaited()
    db.refresh.assert_awaited_once()


def test_foreign_moderator_cannot_send_message_into_taken_ticket(support_service):
    service, ticket_repo, _ = support_service
    ticket_repo.find.return_value = make_ticket(
        status=SupportTicketStatus.IN_PROGRESS,
        moderator_id=77,
        assigned_at=datetime.now(timezone.utc),
    )

    with pytest.raises(ValueError):
        asyncio.run(
            service.send_message(
                ticket_id=5,
                sender_id=11,
                text="Чужой ответ",
                is_from_moderator=True,
            )
        )


def test_student_cannot_send_message_to_closed_ticket(support_service):
    service, ticket_repo, _ = support_service
    ticket_repo.find.return_value = make_ticket(
        status=SupportTicketStatus.CLOSED,
        closed_at=datetime.now(timezone.utc),
    )

    with pytest.raises(ValueError):
        asyncio.run(service.send_message(ticket_id=1, sender_id=2, text="ping"))


def test_reopen_ticket_sets_default_month_expiration(support_service):
    service, ticket_repo, db = support_service
    ticket = make_ticket(
        status=SupportTicketStatus.CLOSED,
        closed_at=datetime.now(timezone.utc),
    )
    ticket_repo.find.return_value = ticket

    reopened = asyncio.run(service.reopen_ticket(ticket_id=9))

    assert reopened.status == SupportTicketStatus.OPEN
    assert reopened.closed_at is None
    assert reopened.session_expires_at is not None
    assert reopened.session_expires_at > datetime.now(timezone.utc) + timedelta(days=29)
    db.commit.assert_awaited()


def test_archived_ticket_cannot_be_reopened(support_service):
    service, ticket_repo, _ = support_service
    ticket_repo.find.return_value = make_ticket(
        status=SupportTicketStatus.CLOSED,
        archived_at=datetime.now(timezone.utc),
        closed_at=datetime.now(timezone.utc),
    )

    with pytest.raises(ValueError):
        asyncio.run(service.reopen_ticket(ticket_id=12))
