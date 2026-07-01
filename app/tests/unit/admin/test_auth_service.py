import asyncio
import sys
import types
import pytest
from unittest.mock import AsyncMock, MagicMock

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))
sys.modules.setdefault(
    "structlog",
    types.SimpleNamespace(
        get_logger=lambda: types.SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None, error=lambda *a, **k: None)
    ),
)

if "fastapi" not in sys.modules:
    fastapi_module = types.ModuleType("fastapi")

    class BackgroundTasks:
        def add_task(self, *args, **kwargs):
            return None

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class UploadFile:
        def __init__(self, *args, **kwargs):
            pass

    fastapi_module.BackgroundTasks = BackgroundTasks
    fastapi_module.HTTPException = HTTPException
    fastapi_module.UploadFile = UploadFile
    sys.modules["fastapi"] = fastapi_module

if "jinja2" not in sys.modules:
    jinja2_module = types.ModuleType("jinja2")

    class _Template:
        def render(self, ctx):
            return str(ctx)

    class Environment:
        def __init__(self, *args, **kwargs):
            pass

        def get_template(self, name):
            return _Template()

    class FileSystemLoader:
        def __init__(self, *args, **kwargs):
            pass

    jinja2_module.Environment = Environment
    jinja2_module.FileSystemLoader = FileSystemLoader
    sys.modules["jinja2"] = jinja2_module

if "passlib.context" not in sys.modules:
    passlib_module = types.ModuleType("passlib")
    passlib_context_module = types.ModuleType("passlib.context")

    class CryptContext:
        def __init__(self, *args, **kwargs):
            pass

        def hash(self, value):
            return f"hashed::{value}"

        def verify(self, plain, hashed):
            return hashed == f"hashed::{plain}"

    passlib_context_module.CryptContext = CryptContext
    sys.modules["passlib"] = passlib_module
    sys.modules["passlib.context"] = passlib_context_module

if "app.infrastructure.jwt_handler" not in sys.modules:
    jwt_handler_module = types.ModuleType("app.infrastructure.jwt_handler")
    jwt_handler_module.create_access_token = lambda data, expires_delta=None: "access-token"
    jwt_handler_module.create_refresh_token = lambda data, expires_delta=None: "refresh-token"
    jwt_handler_module.verify_token = lambda token, refresh=False: None
    sys.modules["app.infrastructure.jwt_handler"] = jwt_handler_module

if "app.utils.rate_limiter" not in sys.modules:
    rate_module = types.ModuleType("app.utils.rate_limiter")

    async def _false(*args, **kwargs):
        return False

    async def _noop(*args, **kwargs):
        return None

    rate_module.rate_limiter = types.SimpleNamespace(is_limited=_false, increment=_noop, reset=_noop)
    sys.modules["app.utils.rate_limiter"] = rate_module

if "sqlalchemy" not in sys.modules:
    sqlalchemy_module = types.ModuleType("sqlalchemy")
    sqlalchemy_module.select = lambda *args, **kwargs: None
    sqlalchemy_module.desc = lambda value: value
    sqlalchemy_module.func = types.SimpleNamespace(lower=lambda value: value)
    sys.modules["sqlalchemy"] = sqlalchemy_module

if "app.models.user" not in sys.modules:
    user_module = types.ModuleType("app.models.user")

    class Users:
        pass

    user_module.Users = Users
    sys.modules["app.models.user"] = user_module

if "app.schemas.admin.auth" not in sys.modules:
    auth_schema_module = types.ModuleType("app.schemas.admin.auth")

    class UserRegister:
        pass

    auth_schema_module.UserRegister = UserRegister
    sys.modules["app.schemas.admin.auth"] = auth_schema_module

if "app.schemas.admin.user_tokens" not in sys.modules:
    token_schema_module = types.ModuleType("app.schemas.admin.user_tokens")

    class UserTokenCreate:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    token_schema_module.UserTokenCreate = UserTokenCreate
    sys.modules["app.schemas.admin.user_tokens"] = token_schema_module

if "app.services.admin.user_token_service" not in sys.modules:
    token_service_module = types.ModuleType("app.services.admin.user_token_service")
    token_service_module.UserTokenService = object
    sys.modules["app.services.admin.user_token_service"] = token_service_module

from app.models.enums import UserRole, UserStatus
from app.services.auth_service import AuthService


def _make_user(
    *,
    user_id=1,
    email="test@example.com",
    hashed_password="hashed-password",
    role=UserRole.SUPER_ADMIN,
    status=UserStatus.ACTIVE,
    is_active=True,
    session_version=1,
    api_access_version=1,
    api_refresh_version=1,
):
    user = MagicMock()
    user.id = user_id
    user.email = email
    user.hashed_password = hashed_password
    user.role = role
    user.status = status
    user.is_active = is_active
    user.first_name = "Test"
    user.last_name = "User"
    user.avatar_path = None
    user.session_version = session_version
    user.api_access_version = api_access_version
    user.api_refresh_version = api_refresh_version
    return user


@pytest.fixture
def auth_service():
    repo = MagicMock()
    repo.db = MagicMock()
    repo.db.execute = AsyncMock()
    repo.db.commit = AsyncMock()
    repo.db.refresh = AsyncMock()
    repo.db.add = MagicMock()
    repo.get_by_email = AsyncMock(return_value=None)
    repo.find = AsyncMock(return_value=None)
    token_service = MagicMock()
    token_service.consume_reset_password_token = AsyncMock()
    token_service.consume_verify_email_token = AsyncMock()
    service = AuthService(repo, token_service)
    return service


def test_authenticate_user_not_found(auth_service, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.rate_limiter.is_limited", AsyncMock(return_value=False))
    monkeypatch.setattr("app.services.auth_service.rate_limiter.increment", AsyncMock(return_value=1))

    result = asyncio.run(auth_service.authenticate("unknown@example.com", "password", ip="127.0.0.1"))

    assert result is None
    auth_service.repository.get_by_email.assert_awaited_once_with("unknown@example.com")


def test_authenticate_success_resets_rate_limit(auth_service, monkeypatch):
    user = _make_user()
    auth_service.repository.get_by_email = AsyncMock(return_value=user)
    monkeypatch.setattr("app.services.auth_service.rate_limiter.is_limited", AsyncMock(return_value=False))
    monkeypatch.setattr("app.services.auth_service.rate_limiter.increment", AsyncMock(return_value=1))
    reset_mock = AsyncMock()
    monkeypatch.setattr("app.services.auth_service.rate_limiter.reset", reset_mock)
    monkeypatch.setattr(auth_service, "verify_password", lambda p, h: True)

    result = asyncio.run(auth_service.authenticate("test@example.com", "password", ip="127.0.0.1"))

    assert result == user
    reset_mock.assert_awaited_once()


def test_api_refresh_token_rotates_refresh_version(auth_service, monkeypatch):
    user = _make_user(api_access_version=4, api_refresh_version=7)
    execute_result = MagicMock()
    execute_result.scalars.return_value.first.return_value = user
    auth_service.db.execute = AsyncMock(return_value=execute_result)

    class _Stmt:
        def filter(self, *args, **kwargs):
            return self

    monkeypatch.setattr(
        "app.services.auth_service.verify_token",
        lambda token, refresh=False: {"sub": "1", "rv": 7, "type": "refresh"},
    )
    monkeypatch.setattr("app.services.auth_service.create_access_token", lambda payload: "access-token")
    monkeypatch.setattr("app.services.auth_service.create_refresh_token", lambda payload: "refresh-token")
    monkeypatch.setattr("app.services.auth_service.select", lambda *args, **kwargs: _Stmt())
    monkeypatch.setattr("app.services.auth_service.Users", types.SimpleNamespace(id=1))

    result = asyncio.run(auth_service.api_refresh_token("refresh"))

    assert result == {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "token_type": "bearer",
    }
    assert user.api_refresh_version == 8
    auth_service.db.commit.assert_awaited_once()
    auth_service.db.refresh.assert_awaited_once_with(user)


def test_verify_code_only_consumes_scoped_reset_token(auth_service):
    user = _make_user()
    auth_service.repository.find = AsyncMock(return_value=user)

    result = asyncio.run(auth_service.verify_code_only(user.id, "123456"))

    assert result is True
    auth_service.user_token_service.consume_reset_password_token.assert_awaited_once_with(user.id, "123456")


def test_reset_password_final_revokes_all_versions(auth_service, monkeypatch):
    user = _make_user(session_version=2, api_access_version=3, api_refresh_version=4)
    auth_service.repository.find = AsyncMock(return_value=user)
    monkeypatch.setattr("app.services.auth_service.hash_password", lambda value: "new-hash")

    result = asyncio.run(auth_service.reset_password_final(user.id, "StrongPass123!"))

    assert result == user
    assert user.hashed_password == "new-hash"
    assert user.session_version == 3
    assert user.api_access_version == 4
    assert user.api_refresh_version == 5
    auth_service.db.commit.assert_awaited_once()
    auth_service.db.refresh.assert_awaited_once_with(user)
