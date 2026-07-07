from __future__ import annotations

import asyncio
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlencode, urlparse

import structlog
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.infrastructure.database import async_session_maker, engine
from app.infrastructure.logger import setup_logging
from app.middlewares.security_headers import SecurityHeadersMiddleware
from app.middlewares.upload_protection import UploadProtectionMiddleware
from app.routers.api.auth import router as api_auth_router
from app.routers.api.v1 import router as api_v1_router
from app.security.csrf import get_csrf_token
from app.services.admin.support_maintenance import process_support_ticket_maintenance

load_dotenv()

setup_logging(
    json_logs=settings.ENV == "production",
    log_level="DEBUG" if settings.DEBUG else "INFO",
)
logger = structlog.get_logger()
SPA_DIR = Path("static/spa")


async def _support_maintenance_loop():
    while True:
        try:
            async with async_session_maker() as db:
                stats = await process_support_ticket_maintenance(db)
                if stats["closed"]:
                    logger.info("support_ticket_maintenance_completed", **stats)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("support_ticket_maintenance_failed", error=str(exc))
        await asyncio.sleep(3600)


async def _apply_schema_updates():
    """Idempotent safety net that runs AFTER alembic in entrypoint.sh.

    Alembic is the primary migration path (see entrypoint.sh). This function
    covers edge cases where alembic is not yet in sync with hand-applied
    production schema — all statements use IF NOT EXISTS / try/except so they
    never fail on an already-correct schema.
    """
    from sqlalchemy import text

    alter_statements = [
        # support_tickets lifecycle columns
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
        # users security columns
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_access_version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_refresh_version INTEGER NOT NULL DEFAULT 1",
        # user_tokens
        "ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ",
        # achievement assignment
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        # user moderation assignment
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        # groups and session GPA
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS study_group VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_gpa VARCHAR",
        # achievement result
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'achievementresult') THEN CREATE TYPE achievementresult AS ENUM ('PARTICIPANT', 'PRIZEWINNER', 'WINNER'); END IF; END $$",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS result achievementresult",
        # achievement external_url (file OR link)
        "ALTER TABLE achievements ALTER COLUMN file_path DROP NOT NULL",
        "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS external_url VARCHAR",
        # rename legacy study groups to ИОП-ИТ scheme
        "UPDATE users SET study_group = 'ИОП-ИТ-25/1' WHERE study_group = 'С-101'",
        "UPDATE users SET study_group = 'ИОП-ИТ-25/2' WHERE study_group = 'С-102'",
        "UPDATE users SET study_group = 'ИОП-ИТ-24/1' WHERE study_group = 'С-201'",
        "UPDATE users SET study_group = 'ИОП-ИТ-24/2' WHERE study_group = 'С-202'",
        # --- Performance indexes (idempotent). FKs are NOT auto-indexed by
        # Postgres, so per-user lookups, the leaderboard aggregation and the
        # scoped user list did sequential scans. ---
        "CREATE INDEX IF NOT EXISTS ix_achievements_user_status ON achievements (user_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_status ON achievements (status)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_category ON achievements (category)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_created_at ON achievements (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_moderator_id ON achievements (moderator_id)",
        "CREATE INDEX IF NOT EXISTS ix_users_role ON users (role)",
        "CREATE INDEX IF NOT EXISTS ix_users_status ON users (status)",
        "CREATE INDEX IF NOT EXISTS ix_users_zone ON users (education_level, course, study_group)",
        "CREATE INDEX IF NOT EXISTS ix_users_created_at ON users (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_season_results_user_id ON season_results (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_user_notes_user_id ON user_notes (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_user_status ON support_tickets (user_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_support_messages_ticket_id ON support_messages (ticket_id)",
    ]

    # ── Add missing enum values (PostgreSQL 12+ supports ADD VALUE in transactions) ──
    enum_additions = [
        "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'HACKATHON'",
        "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'Хакатон'",
        "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'PATRIOTISM'",
        "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'PROJECTS'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'PARTICIPANT'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'PRIZEWINNER'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'WINNER'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'Участник'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'Призёр'",
        "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'Победитель'",
    ]

    async with engine.begin() as conn:
        # Add enum values first (before create_all which might skip existing types)
        # Each runs in a SAVEPOINT so a failure doesn't abort the transaction
        for stmt in enum_additions:
            try:
                async with conn.begin_nested():
                    await conn.execute(text(stmt))
            except Exception:
                pass  # type doesn't exist yet — create_all will handle it

        # Fix supportticketstatus enum if values don't match
        enum_check = await conn.execute(text(
            "SELECT enumlabel FROM pg_enum "
            "JOIN pg_type ON pg_enum.enumtypid = pg_type.oid "
            "WHERE pg_type.typname = 'supportticketstatus' ORDER BY enumsortorder"
        ))
        existing_labels = [row[0] for row in enum_check.fetchall()]
        expected_labels = ["open", "in_progress", "closed"]
        if existing_labels and existing_labels != expected_labels:
            await conn.execute(text(
                "ALTER TABLE support_tickets ALTER COLUMN status DROP DEFAULT"
            ))
            await conn.execute(text(
                "ALTER TABLE support_tickets ALTER COLUMN status TYPE VARCHAR(20)"
            ))
            await conn.execute(text(
                "UPDATE support_tickets SET status = LOWER(status)"
            ))
            await conn.execute(text("DROP TYPE IF EXISTS supportticketstatus"))
            await conn.execute(text(
                "CREATE TYPE supportticketstatus AS ENUM ('open', 'in_progress', 'closed')"
            ))
            await conn.execute(text(
                "ALTER TABLE support_tickets ALTER COLUMN status TYPE supportticketstatus "
                "USING status::supportticketstatus"
            ))
            await conn.execute(text(
                "ALTER TABLE support_tickets ALTER COLUMN status SET DEFAULT 'open'"
            ))

        # Create any brand-new tables first
        from app.infrastructure.database import Base
        await conn.run_sync(Base.metadata.create_all)
        # Then add missing columns to existing tables
        for stmt in alter_statements:
            try:
                async with conn.begin_nested():
                    await conn.execute(text(stmt))
            except Exception:
                pass  # column/table may already exist


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _apply_schema_updates()
    from app.utils.storage import ensure_bucket
    await ensure_bucket()
    task = asyncio.create_task(_support_maintenance_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await engine.dispose()
        logger.info("Database engine disposed. Graceful shutdown complete.")


ENV = os.getenv("ENV", "development")
IS_DEBUG = str(os.getenv("DEBUG", "False")).lower() in ("true", "1", "yes")

if ENV == "production":
    IS_DEBUG = False

app = FastAPI(
    root_path=os.getenv("ROOT_PATH", ""),
    lifespan=lifespan,
    docs_url="/docs" if ENV != "production" else None,
    redoc_url="/redoc" if ENV != "production" else None,
    openapi_url="/openapi.json" if ENV != "production" else None,
)
FLASH_TOAST_SESSION_KEY = "_toast"


class CSRFContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        get_csrf_token(request)
        response = await call_next(request)
        response.set_cookie(
            "XSRF-TOKEN",
            request.session.get("csrf_token", ""),
            secure=ENV == "production",
            httponly=False,
            samesite="lax",
            path="/",
        )
        return response


def _request_wants_html(request: Request) -> bool:
    if request.method not in {"GET", "HEAD"}:
        return False
    if request.url.path.startswith("/static") or request.url.path.startswith("/ws"):
        return False
    if request.headers.get("sec-fetch-dest") == "document":
        return True
    accept = request.headers.get("accept", "")
    return "text/html" in accept


class FlashToastMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            session = request.session
        except AssertionError:
            return await call_next(request)

        request.state.toast = None

        if _request_wants_html(request):
            toast_msg = request.query_params.get("toast_msg")
            if toast_msg:
                session[FLASH_TOAST_SESSION_KEY] = {
                    "message": toast_msg,
                    "type": "success" if request.query_params.get("toast_type") == "success" else "error",
                }
                filtered_params = [
                    (key, value)
                    for key, value in request.query_params.multi_items()
                    if key not in {"toast_msg", "toast_type"}
                ]
                clean_query = urlencode(filtered_params, doseq=True)
                clean_url = str(request.url.replace(query=clean_query))
                return RedirectResponse(url=clean_url, status_code=303)

            request.state.toast = session.pop(FLASH_TOAST_SESSION_KEY, None)

        response = await call_next(request)
        return response


app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount(
    "/sirius.achievements/app/assets",
    StaticFiles(directory="static/spa/assets", check_dir=False),
    name="spa-assets",
)

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY or SECRET_KEY == "supersecretkey123":
    if ENV == "production":
        raise ValueError("Критическая ошибка: не установлен безопасный SECRET_KEY.")
    logger.warning("SECRET_KEY не установлен, используется временный ключ разработки.")
    SECRET_KEY = secrets.token_urlsafe(32)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(UploadProtectionMiddleware)
app.add_middleware(CSRFContextMiddleware)
app.add_middleware(FlashToastMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    https_only=ENV == "production",
    same_site="lax",
    max_age=settings.SESSION_MAX_AGE,
)

ALLOWED_HOSTS = [host.strip() for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if host.strip()]
TRUSTED_PROXY_IPS = [host.strip() for host in settings.TRUSTED_PROXY_IPS.split(",") if host.strip()]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=TRUSTED_PROXY_IPS)

app.include_router(api_auth_router)
app.include_router(api_v1_router)


def _origin_allowed(origin: str | None, host_header: str | None) -> bool:
    if not origin:
        # Reject WS upgrades without an Origin header — real browsers always
        # send one; missing Origin usually means a non-browser client bypassing
        # same-origin protections.
        return False

    parsed = urlparse(origin)
    origin_host = parsed.hostname
    if not origin_host:
        return False

    allowed_hosts = {item.split(":")[0] for item in ALLOWED_HOSTS}
    if "*" in allowed_hosts or origin_host in allowed_hosts:
        return True

    if host_header:
        request_host = host_header.split(":")[0]
        if origin_host == request_host:
            return True

    return False


def _extract_ws_token_and_subprotocol(websocket: WebSocket) -> tuple[str | None, str | None]:
    requested_subprotocols = [item for item in websocket.scope.get("subprotocols", []) if item]
    if requested_subprotocols:
        return requested_subprotocols[-1], requested_subprotocols[-1]

    header_value = websocket.headers.get("sec-websocket-protocol")
    if header_value:
        parts = [item.strip() for item in header_value.split(",") if item.strip()]
        if parts:
            return parts[-1], parts[-1]

    token = websocket.query_params.get("token")
    return token, None


def _error_page(status_code: int, title: str, message: str) -> HTMLResponse:
    return HTMLResponse(
        content=f"""<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #120f1d;
        --card: rgba(28, 23, 43, 0.92);
        --text: #f5f7fb;
        --muted: #b8bed3;
        --accent: #9c7bff;
        --border: rgba(156, 123, 255, 0.22);
      }}

      * {{
        box-sizing: border-box;
      }}

      body {{
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, Segoe UI, sans-serif;
        background:
          radial-gradient(circle at top, rgba(156, 123, 255, 0.22), transparent 35%),
          linear-gradient(180deg, #171226 0%, var(--bg) 100%);
        color: var(--text);
      }}

      main {{
        width: min(100%, 560px);
        padding: 32px;
        border-radius: 24px;
        background: var(--card);
        border: 1px solid var(--border);
        box-shadow: 0 24px 60px rgba(6, 5, 10, 0.35);
      }}

      .code {{
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(156, 123, 255, 0.14);
        color: #d7cbff;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }}

      h1 {{
        margin: 18px 0 12px;
        font-size: clamp(28px, 6vw, 42px);
        line-height: 1.05;
      }}

      p {{
        margin: 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.6;
      }}

      a {{
        display: inline-flex;
        margin-top: 24px;
        padding: 12px 18px;
        border-radius: 14px;
        background: linear-gradient(135deg, #8c6fff, #b59cff);
        color: #120f1d;
        text-decoration: none;
        font-weight: 700;
      }}
    </style>
  </head>
  <body>
    <main>
      <span class="code">{status_code}</span>
      <h1>{title}</h1>
      <p>{message}</p>
      <a href="/sirius.achievements/app/login">Вернуться ко входу</a>
    </main>
  </body>
</html>""",
        status_code=status_code,
    )


def _wants_json(request: Request) -> bool:
    # API / XHR clients must get machine-readable JSON errors (with the real
    # `detail`) so the SPA can show them; only browser navigation gets the HTML page.
    return request.url.path.startswith("/api/") or "application/json" in request.headers.get("accept", "")


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if 300 <= exc.status_code < 400:
        location = exc.headers.get("Location") if exc.headers else None
        if location:
            return RedirectResponse(url=location, status_code=exc.status_code)
    if _wants_json(request):
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail else "Не удалось обработать запрос."
        return JSONResponse({"detail": detail}, status_code=exc.status_code)
    if exc.status_code == 404:
        return _error_page(404, "Страница не найдена", "Такого адреса больше нет или он был перенесен.")
    if exc.status_code == 403:
        return _error_page(403, "Доступ запрещен", "У вас нет прав для просмотра этой страницы.")
    return _error_page(exc.status_code, "Ошибка", "Не удалось обработать запрос. Попробуйте еще раз.")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("global_error", error=str(exc), exc_info=True)
    if _wants_json(request):
        return JSONResponse({"detail": "Внутренняя ошибка сервера."}, status_code=500)
    return _error_page(500, "Внутренняя ошибка сервера", "Мы уже получили информацию об ошибке и разберемся с ней.")


@app.get("/health", include_in_schema=False)
async def health_check():
    # Liveness probe: intentionally checks ONLY the database so a transient
    # Redis/MinIO blip does not make Jenkins refuse to deploy or thrash the
    # container. Use /health/deep for a full dependency breakdown.
    try:
        async with async_session_maker() as session:
            from sqlalchemy import text

            await session.execute(text("SELECT 1"))
        return JSONResponse({"status": "ok", "database": "connected"})
    except Exception:
        return JSONResponse({"status": "error", "database": "unavailable"}, status_code=503)


@app.get("/health/deep", include_in_schema=False)
async def health_deep():
    # Readiness/diagnostic probe: reports every backing service separately so
    # monitoring never shows a false green (today's incident: Redis down, login
    # 500, but /health stayed 200 because it only checked the DB).
    from sqlalchemy import text

    from app.utils import storage
    from app.utils.rate_limiter import get_redis

    services: dict[str, str] = {}

    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
        services["database"] = "ok"
    except Exception:
        services["database"] = "down"

    try:
        await asyncio.wait_for(get_redis().ping(), timeout=3)
        services["redis"] = "ok"
    except Exception:
        services["redis"] = "down"

    try:
        await asyncio.wait_for(storage.ping(), timeout=5)
        services["minio"] = "ok"
    except Exception:
        services["minio"] = "down"

    all_ok = all(status == "ok" for status in services.values())
    return JSONResponse(
        {"status": "ok" if all_ok else "degraded", "services": services},
        status_code=200 if all_ok else 503,
    )


@app.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    from app.models.enums import UserStatus
    from app.models.user import Users
    from app.infrastructure.jwt_handler import verify_token
    from app.services.ws_manager import ws_manager

    if not _origin_allowed(websocket.headers.get("origin"), websocket.headers.get("host")):
        await websocket.close(code=1008)
        return

    session = websocket.session or {}
    user_id = session.get("auth_id")
    session_version = session.get("auth_session_version")
    expected_version_field = "session_version"

    if not user_id or session_version is None:
        token, selected_subprotocol = _extract_ws_token_and_subprotocol(websocket)
        payload = verify_token(token) if token else None
        if not payload or payload.get("type") != "access":
            await websocket.close(code=4001)
            return
        user_id = payload.get("sub")
        session_version = payload.get("av")
        expected_version_field = "api_access_version"
        if not user_id or session_version is None:
            await websocket.close(code=4001)
            return

    async with async_session_maker() as db:
        user = await db.get(Users, int(user_id))
        expected_version = getattr(user, expected_version_field, 0) if user else 0
        if (
            not user
            or user.status == UserStatus.REJECTED
            or not user.is_active
            or int(session_version) != int(expected_version or 0)
        ):
            await websocket.close(code=4001)
            return

    if "selected_subprotocol" not in locals():
        _token, selected_subprotocol = _extract_ws_token_and_subprotocol(websocket)

    await ws_manager.connect(int(user_id), websocket, subprotocol=selected_subprotocol)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(int(user_id), websocket)


@app.get("/")
async def root(request: Request):
    return RedirectResponse(url="/sirius.achievements/app/login")


@app.get("/admin")
async def admin_root(request: Request):
    return RedirectResponse(url="/sirius.achievements/app/dashboard")


@app.post("/sirius.achievements/logout", include_in_schema=False, name="admin.auth.logout")
async def legacy_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/sirius.achievements/app/login", status_code=303)


def _spa_index_response() -> FileResponse | RedirectResponse:
    index_path = SPA_DIR / "index.html"
    if not index_path.exists():
        return RedirectResponse(url="/sirius.achievements/login")
    return FileResponse(index_path)


@app.get("/sirius.achievements/app", include_in_schema=False)
async def spa_entry():
    return _spa_index_response()


@app.get("/sirius.achievements/app/{path:path}", include_in_schema=False)
async def spa_catch_all(path: str):
    if path.startswith("api/") or path.startswith("static/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    return _spa_index_response()


@app.get("/sirius.achievements/{path:path}", include_in_schema=False)
async def legacy_redirect(path: str):
    """Redirect old Jinja2 URLs to React SPA."""
    return RedirectResponse(url=f"/sirius.achievements/app/{path}")
