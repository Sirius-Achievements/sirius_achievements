from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth_optional
from app.models.bug_report import BugReport
from app.utils.rate_limiter import rate_limiter

router = APIRouter(prefix='/api/v1/bug-reports', tags=['api.v1.bug_reports'])


class BugReportPayload(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    page_url: str = Field(min_length=1, max_length=2048)
    session_id: str | None = Field(default=None, max_length=255)
    app_version: str | None = Field(default=None, max_length=100)


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
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {'id': report.id, 'created_at': report.created_at}
