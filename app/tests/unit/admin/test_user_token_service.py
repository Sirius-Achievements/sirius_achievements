import asyncio
import importlib
import sys
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

if "fastapi" not in sys.modules:
    fastapi_module = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    fastapi_module.HTTPException = HTTPException
    sys.modules["fastapi"] = fastapi_module

if "sqlalchemy" not in sys.modules:
    sqlalchemy_module = types.ModuleType("sqlalchemy")
    sqlalchemy_module.desc = lambda value: value
    sqlalchemy_module.select = lambda value: value
    sys.modules["sqlalchemy"] = sqlalchemy_module

if "app.repositories.admin.user_token_repository" not in sys.modules:
    repo_module = types.ModuleType("app.repositories.admin.user_token_repository")
    repo_module.UserTokenRepository = object
    sys.modules["app.repositories.admin.user_token_repository"] = repo_module

if "app.schemas.admin.user_tokens" not in sys.modules:
    token_schema_module = types.ModuleType("app.schemas.admin.user_tokens")

    class UserTokenCreate:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    token_schema_module.UserTokenCreate = UserTokenCreate
    sys.modules["app.schemas.admin.user_tokens"] = token_schema_module

from fastapi import HTTPException

from app.models.enums import UserTokenType
from app.schemas.admin.user_tokens import UserTokenCreate

existing_service_module = sys.modules.get("app.services.admin.user_token_service")
if existing_service_module is not None and not getattr(existing_service_module, "__file__", None):
    del sys.modules["app.services.admin.user_token_service"]

UserTokenService = importlib.import_module("app.services.admin.user_token_service").UserTokenService


@pytest.fixture
def mock_repo():
    repo = MagicMock()
    repo.create = AsyncMock()
    repo.find_active_token = AsyncMock()
    repo.invalidate_user_tokens = AsyncMock()
    repo.mark_used = AsyncMock()
    repo.delete = AsyncMock()
    repo.db = MagicMock()
    repo.db.execute = AsyncMock()
    repo.model = MagicMock()
    return repo


@pytest.fixture
def service(mock_repo):
    return UserTokenService(repo=mock_repo)


def test_create_user_token_invalidates_previous_active_tokens(service, mock_repo):
    data = UserTokenCreate(user_id=1, type=UserTokenType.RESET_PASSWORD)
    mock_repo.create.return_value = MagicMock(id=1, token="123456")

    result = asyncio.run(service.create(data))

    assert result.token == "123456"
    mock_repo.invalidate_user_tokens.assert_awaited_once_with(1, UserTokenType.RESET_PASSWORD)
    mock_repo.create.assert_awaited_once()
    call_args = mock_repo.create.call_args.args[0]
    assert call_args["user_id"] == 1
    assert len(call_args["token"]) == 6
    assert call_args["token"].isdigit()
    assert call_args["expires_at"] > datetime.now(timezone.utc)


def test_get_reset_password_token_success(service, mock_repo):
    token = MagicMock()
    token.token_type = UserTokenType.RESET_PASSWORD.value
    token.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    mock_repo.find_active_token.return_value = token

    result = asyncio.run(service.getResetPasswordToken(10, "123456"))

    assert result == token
    mock_repo.find_active_token.assert_awaited_once_with(10, UserTokenType.RESET_PASSWORD, "123456")


def test_get_reset_password_token_not_found(service, mock_repo):
    mock_repo.find_active_token.return_value = None

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.getResetPasswordToken(10, "invalid"))

    assert exc.value.status_code == 404


def test_consume_reset_password_token_marks_token_as_used(service, mock_repo):
    token = MagicMock()
    token.id = 77
    token.token_type = UserTokenType.RESET_PASSWORD.value
    token.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    token.used_at = None
    mock_repo.find_active_token.return_value = token

    result = asyncio.run(service.consume_reset_password_token(10, "123456"))

    assert result == token
    mock_repo.mark_used.assert_awaited_once_with(77)
    assert result.used_at is not None


def test_delete_token(service, mock_repo):
    mock_repo.delete.return_value = True

    result = asyncio.run(service.delete(1))

    mock_repo.delete.assert_awaited_once_with(1)
    assert result is True
