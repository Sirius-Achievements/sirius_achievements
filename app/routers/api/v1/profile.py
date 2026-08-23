from __future__ import annotations

import re
import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
import jwt as pyjwt
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.infrastructure.jwt_handler import ALGORITHM, SECRET_KEY, JWTError
from app.middlewares.api_auth_middleware import auth
from app.models.achievement import Achievement
from app.models.enums import AchievementStatus, UserStatus
from app.models.resume_version import ResumeVersion
from app.repositories.admin.user_repository import UserRepository
from app.repositories.admin.user_token_repository import UserTokenRepository
from app.schemas.admin.auth import ResetPasswordSchema
from app.services.admin.resume_service import ResumeService
from app.services.admin.user_service import UserService
from app.services.admin.user_token_service import UserTokenService
from app.services.auth_service import AuthService
from app.utils.points import calculate_gpa_bonus
from app.utils.rate_limiter import rate_limiter
from app.utils.season_history import load_season_history

from .serializers import serialize_achievement, serialize_user

router = APIRouter(prefix='/api/v1/profile', tags=['api.v1.profile'])

_PHONE_RE = re.compile(r'^[\d\s\+\-\(\)]{0,20}$')
_EMOJI_RE = re.compile(
    '[\U0001F600-\U0001F64F'
    '\U0001F300-\U0001F5FF'
    '\U0001F680-\U0001F6FF'
    '\U0001F700-\U0001F77F'
    '\U0001F780-\U0001F7FF'
    '\U0001F800-\U0001F8FF'
    '\U0001F900-\U0001F9FF'
    '\U0001FA00-\U0001FA6F'
    '\U0001FA70-\U0001FAFF'
    '\U00002702-\U000027B0'
    '\U000024C2-\U0001F251]+',
    flags=re.UNICODE,
)

PUBLIC_VISIBILITY_DEFAULTS = {
    'avatar': True,
    'gpa': True,
    'analytics': True,
    'achievements': True,
    'resume': True,
    'score': True,
    'hall_of_fame': True,
}


class FlowTokenPayload(BaseModel):
    flow_id: str


class VerifyPasswordCodePayload(FlowTokenPayload):
    code: str


class ResetPasswordPayload(FlowTokenPayload):
    new_password: str
    confirm_password: str


def _create_flow_token(user_id: int, purpose: str, ttl_minutes: int = 30) -> str:
    payload = {
        'sub': str(user_id),
        'purpose': purpose,
        'type': 'flow',
        'exp': datetime.now(UTC) + timedelta(minutes=ttl_minutes),
    }
    return pyjwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _parse_flow_token(token: str, expected_purpose: str) -> int:
    try:
        payload = pyjwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except pyjwt.exceptions.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Недействительный flow token') from exc

    if payload.get('type') != 'flow' or payload.get('purpose') != expected_purpose:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Неверное назначение flow token')

    user_id = payload.get('sub')
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Flow token не содержит пользователя')

    return int(user_id)


def get_auth_service(db: AsyncSession = Depends(get_db)):
    user_repo = UserRepository(db)
    token_repo = UserTokenRepository(db)
    token_service = UserTokenService(token_repo)
    return AuthService(user_repo, token_service)


def get_user_service(db: AsyncSession = Depends(get_db)):
    return UserService(UserRepository(db))


def _ensure_account_not_deleted(current_user) -> None:
    if current_user.status == UserStatus.DELETED:
        raise HTTPException(status_code=403, detail='Аккаунт удалён. Доступна только поддержка.')


@router.get('')
@router.get('/')
async def profile(
    season: str = Query(default='current', max_length=100),
    current_user=Depends(auth),
    db: AsyncSession = Depends(get_db),
):
    _ensure_account_not_deleted(current_user)

    user = current_user
    resume_service = ResumeService(db)
    check = await resume_service.can_generate(user.id)
    season_history = await load_season_history(db, user.id)
    archived_approved = and_(
        Achievement.status == AchievementStatus.ARCHIVED,
        or_(
            Achievement.archived_from_status == AchievementStatus.APPROVED.value,
            Achievement.archived_from_status.is_(None),
        ),
    )
    if season == 'current':
        analytics_filter = Achievement.status == AchievementStatus.APPROVED
    elif season == 'all':
        analytics_filter = or_(Achievement.status == AchievementStatus.APPROVED, archived_approved)
    elif season == 'last2':
        previous = [item.season_name for item in season_history[:1]]
        analytics_filter = or_(
            Achievement.status == AchievementStatus.APPROVED,
            and_(archived_approved, Achievement.archived_season.in_(previous)),
        )
    else:
        if season not in {item.season_name for item in season_history}:
            raise HTTPException(status_code=422, detail='Неизвестный сезон.')
        analytics_filter = and_(archived_approved, Achievement.archived_season == season)

    approved_rows = (await db.execute(
        select(
            func.date_trunc('month', Achievement.created_at).label('bucket'),
            func.count().label('cnt'),
            func.coalesce(func.sum(Achievement.points), 0).label('pts'),
        )
        .filter(Achievement.user_id == user.id, analytics_filter)
        .group_by('bucket')
        .order_by('bucket')
    )).all()

    upload_rows = (await db.execute(
        select(
            func.date_trunc('month', Achievement.created_at).label('bucket'),
            func.count().label('cnt'),
        )
        .filter(Achievement.user_id == user.id, analytics_filter)
        .group_by('bucket')
        .order_by('bucket')
    )).all()

    all_months: dict[str, dict] = {}
    for row in approved_rows:
        key = row.bucket.strftime('%m.%Y')
        all_months.setdefault(key, {'points': 0, 'uploads': 0, 'sort': row.bucket})
        all_months[key]['points'] = int(row.pts or 0)
    for row in upload_rows:
        key = row.bucket.strftime('%m.%Y')
        all_months.setdefault(key, {'points': 0, 'uploads': 0, 'sort': row.bucket})
        all_months[key]['uploads'] = int(row.cnt or 0)

    sorted_months = sorted(all_months.items(), key=lambda item: item[1]['sort'])
    if not sorted_months:
        now = datetime.now(UTC)
        sorted_months = [(now.strftime('%m.%Y'), {'points': 0, 'uploads': 0, 'sort': now})]
    cumulative = []
    running = 0
    for _, item in sorted_months:
        running += item['points']
        cumulative.append(running)

    docs = (await db.execute(
        select(Achievement)
        .filter(Achievement.user_id == user.id)
        .order_by(Achievement.created_at.desc())
    )).scalars().all()

    resume_versions = (await db.execute(
        select(ResumeVersion)
        .filter(ResumeVersion.user_id == user.id)
        .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
        .limit(10)
    )).scalars().all()

    analytics_docs = (await db.execute(
        select(Achievement)
        .filter(Achievement.user_id == user.id, analytics_filter)
        .order_by(Achievement.created_at.desc())
    )).scalars().all()

    completed_fields = [
        bool(user.first_name),
        bool(user.last_name),
        bool(user.phone_number),
        bool(user.avatar_path),
        bool(user.education_level),
        bool(user.course),
        bool(user.study_group),
    ]

    return {
        'user': serialize_user(user),
        'can_generate': check['allowed'],
        'generate_reason': check.get('reason', ''),
        'chart_labels': [item[0] for item in sorted_months],
        'chart_points': [item[1]['points'] for item in sorted_months],
        'chart_uploads': [item[1]['uploads'] for item in sorted_months],
        'chart_cumulative': cumulative,
        'has_chart_data': bool(sorted_months),
        'my_docs': [serialize_achievement(item) for item in docs],
        'analytics_docs': [serialize_achievement(item) for item in analytics_docs],
        'gpa_bonus': calculate_gpa_bonus(user.session_gpa),
        'profile_completion': round(sum(completed_fields) / len(completed_fields) * 100),
        'public_visibility': {
            key: bool((user.public_visibility or {}).get(key, default))
            for key, default in PUBLIC_VISIBILITY_DEFAULTS.items()
        },
        'season_history': [
            {
                'id': item.id,
                'season_name': item.season_name,
                'points': int(item.points or 0),
                'rank': int(item.rank or 0),
                'created_at': item.created_at.isoformat() if item.created_at else None,
            }
            for item in season_history
        ],
        'selected_season': season,
        'available_seasons': [item.season_name for item in season_history],
        'resume_versions': [
            {
                'id': item.id,
                'text': item.text,
                'source_documents_count': item.source_documents_count,
                'created_at': item.created_at.isoformat() if item.created_at else None,
            }
            for item in resume_versions
        ],
    }


@router.put('')
@router.put('/')
async def update_profile(
    request: Request,
    first_name: str | None = Form(default=None),
    last_name: str | None = Form(default=None),
    phone_number: str | None = Form(default=None),
    public_visibility: str | None = Form(default=None),
    avatar: UploadFile | None = File(default=None),
    current_user=Depends(auth),
    service: UserService = Depends(get_user_service),
):
    _ensure_account_not_deleted(current_user)

    normalized_first_name = _EMOJI_RE.sub('', (first_name or current_user.first_name or '')).strip() or current_user.first_name
    normalized_last_name = _EMOJI_RE.sub('', (last_name or current_user.last_name or '')).strip() or current_user.last_name
    normalized_phone = phone_number.strip() if isinstance(phone_number, str) else phone_number
    normalized_phone = normalized_phone or None

    if not normalized_first_name or not normalized_last_name:
        raise HTTPException(status_code=400, detail='Имя и фамилия обязательны.')

    if normalized_phone and not _PHONE_RE.match(normalized_phone):
        raise HTTPException(status_code=400, detail='Неверный формат телефона.')

    update_data: dict[str, object | None] = {
        'first_name': normalized_first_name,
        'last_name': normalized_last_name,
        'phone_number': normalized_phone,
    }

    if public_visibility is not None:
        try:
            requested_visibility = json.loads(public_visibility)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail='Неверные настройки публичного профиля.') from exc
        if not isinstance(requested_visibility, dict):
            raise HTTPException(status_code=400, detail='Неверные настройки публичного профиля.')
        update_data['public_visibility'] = {
            key: bool(requested_visibility.get(key, default))
            for key, default in PUBLIC_VISIBILITY_DEFAULTS.items()
        }

    if avatar and avatar.filename:
        try:
            path = await service.save_avatar(current_user.id, avatar)
            update_data['avatar_path'] = path
        except ValueError as exc:
            raise HTTPException(status_code=400, detail='Не удалось обновить аватар. Проверьте формат и размер файла.') from exc

    updated_user = await service.repository.update(current_user.id, update_data)
    request.session['auth_name'] = f'{updated_user.first_name} {updated_user.last_name}'
    request.session['auth_avatar'] = updated_user.avatar_path

    return {'success': True, 'user': serialize_user(updated_user)}


@router.post('/password/send-code')
async def send_password_code(
    background_tasks: BackgroundTasks,
    current_user=Depends(auth),
    auth_service: AuthService = Depends(get_auth_service),
):
    _ensure_account_not_deleted(current_user)

    success, message, retry_after, user_id = await auth_service.forgot_password(current_user.email, background_tasks)
    if not success or not user_id:
        raise HTTPException(status_code=400, detail=message)

    return {
        'success': True,
        'message': message,
        'retry_after': retry_after,
        'flow_id': _create_flow_token(user_id, 'profile_password_change', ttl_minutes=30),
    }


@router.post('/password/verify')
async def verify_password_code(
    payload: VerifyPasswordCodePayload,
    current_user=Depends(auth),
    auth_service: AuthService = Depends(get_auth_service),
):
    _ensure_account_not_deleted(current_user)

    user_id = _parse_flow_token(payload.flow_id, 'profile_password_change')
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail='Access denied')

    rl_key = f'profile_pwd_otp:{user_id}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.OTP_LOCKOUT_TTL))
    if attempt_count > settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail='Слишком много попыток. Запросите новый код.')

    try:
        await auth_service.verify_code_only(user_id, payload.code)
        await rate_limiter.reset(rl_key)
        return {
            'verified': True,
            'flow_id': _create_flow_token(user_id, 'profile_password_change_verified', ttl_minutes=30),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail='Неверный код подтверждения') from exc


@router.post('/password/resend')
async def resend_password_code(
    payload: FlowTokenPayload,
    background_tasks: BackgroundTasks,
    current_user=Depends(auth),
    auth_service: AuthService = Depends(get_auth_service),
):
    _ensure_account_not_deleted(current_user)

    user_id = _parse_flow_token(payload.flow_id, 'profile_password_change')
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail='Access denied')

    success, message, retry_after, _ = await auth_service.forgot_password(current_user.email, background_tasks)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {
        'success': True,
        'message': message,
        'retry_after': retry_after,
        'flow_id': _create_flow_token(user_id, 'profile_password_change', ttl_minutes=30),
    }


@router.post('/password/reset')
async def reset_password(
    request: Request,
    payload: ResetPasswordPayload,
    current_user=Depends(auth),
    auth_service: AuthService = Depends(get_auth_service),
):
    _ensure_account_not_deleted(current_user)

    user_id = _parse_flow_token(payload.flow_id, 'profile_password_change_verified')
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail='Access denied')

    try:
        ResetPasswordSchema(password=payload.new_password, password_confirm=payload.confirm_password)
        await auth_service.reset_password_final(user_id, payload.new_password)
        request.session.clear()
        return {'success': True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail='Ошибка смены пароля. Проверьте данные.') from exc
