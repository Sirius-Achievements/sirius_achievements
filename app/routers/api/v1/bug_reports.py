import hashlib
import math
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth, auth_optional
from app.models.bug_report import BugReport
from app.models.enums import UserRole
from app.utils.rate_limiter import rate_limiter
from app.utils.search import escape_like

router = APIRouter(prefix='/api/v1/bug-reports', tags=['api.v1.bug_reports'])


class BugReportPayload(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    page_url: str = Field(min_length=1, max_length=2048)
    session_id: str | None = Field(default=None, max_length=255)
    app_version: str | None = Field(default=None, max_length=100)
    console_summary: str | None = Field(default=None, max_length=8000)
    network_summary: str | None = Field(default=None, max_length=8000)
    session_elapsed_ms: int | None = Field(default=None, ge=0)


def _fingerprint(page_url: str, description: str | None) -> str:
    path = urlsplit(page_url).path.rstrip('/') or '/'
    words = sorted({word.casefold() for word in (description or '').split() if len(word) >= 4})[:12]
    digest = hashlib.sha256(f'{path}|{" ".join(words)}'.encode()).hexdigest()[:20]
    return f'{path[:180]}:{digest}'


async def _require_super_admin(current_user=Depends(auth)):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Доступ только для супер-администратора.')
    return current_user


def _serialize_report(report: BugReport) -> dict:
    user = report.user
    return {
        'id': report.id,
        'description': report.description,
        'page_url': report.page_url,
        'session_id': report.session_id,
        'app_version': report.app_version,
        'user_agent': report.user_agent,
        'console_summary': report.console_summary,
        'network_summary': report.network_summary,
        'fingerprint': report.fingerprint,
        'status': report.status,
        'session_elapsed_ms': report.session_elapsed_ms,
        'created_at': report.created_at.isoformat() if report.created_at else None,
        'user': (
            {
                'id': user.id,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'email': user.email,
            }
            if user
            else None
        ),
    }


@router.post('', status_code=status.HTTP_201_CREATED)
async def create_bug_report(
    payload: BugReportPayload,
    request: Request,
    current_user=Depends(auth_optional),
    db: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else 'unknown'
    key = f'bug_report:{client_ip}'
    if int(await rate_limiter.increment(key, 3600)) > 10:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много сообщений. Попробуйте позже.')

    report = BugReport(
        user_id=current_user.id if current_user else None,
        description=(payload.description or '').strip() or None,
        page_url=payload.page_url,
        session_id=payload.session_id,
        app_version=payload.app_version,
        user_agent=request.headers.get('user-agent', '')[:1000] or None,
        console_summary=(payload.console_summary or '').strip() or None,
        network_summary=(payload.network_summary or '').strip() or None,
        fingerprint=_fingerprint(payload.page_url, payload.description),
        session_elapsed_ms=payload.session_elapsed_ms,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {'id': report.id, 'created_at': report.created_at}


@router.get('')
async def list_bug_reports(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None, max_length=255),
    current_user=Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Recent bug reports and their session context, available only to super admins."""
    filters = []
    if query and query.strip():
        pattern = f"%{escape_like(query.strip())}%"
        filters.append(
            or_(
                BugReport.description.ilike(pattern, escape='\\'),
                BugReport.page_url.ilike(pattern, escape='\\'),
                BugReport.session_id.ilike(pattern, escape='\\'),
                BugReport.app_version.ilike(pattern, escape='\\'),
            )
        )

    count_stmt = select(func.count(BugReport.id))
    reports_stmt = select(BugReport).options(selectinload(BugReport.user))
    if filters:
        count_stmt = count_stmt.where(*filters)
        reports_stmt = reports_stmt.where(*filters)

    total = (await db.execute(count_stmt)).scalar_one()
    reports = (
        await db.execute(
            reports_stmt.order_by(desc(BugReport.created_at), desc(BugReport.id)).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()

    return {
        'reports': [_serialize_report(report) for report in reports],
        'page': page,
        'page_size': page_size,
        'total': total,
        'total_pages': max(1, math.ceil(total / page_size)),
    }


@router.post('/{report_id}/close-similar')
async def close_similar_bug_reports(
    report_id: int,
    current_user=Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    report = await db.get(BugReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail='Баг-репорт не найден.')
    stmt = select(BugReport).filter(BugReport.status == 'open')
    if report.fingerprint:
        stmt = stmt.filter(BugReport.fingerprint == report.fingerprint)
    else:
        stmt = stmt.filter(BugReport.id == report.id)
    similar = (await db.execute(stmt)).scalars().all()
    for item in similar:
        item.status = 'closed'
    await db.commit()
    return {'success': True, 'closed_count': len(similar)}
