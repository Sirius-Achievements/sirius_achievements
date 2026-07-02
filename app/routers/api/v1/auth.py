from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
import jwt as pyjwt
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.infrastructure.jwt_handler import ALGORITHM, SECRET_KEY, JWTError
from app.middlewares.api_auth_middleware import auth
from app.models.enums import UserRole
from app.repositories.admin.user_repository import UserRepository
from app.repositories.admin.user_token_repository import UserTokenRepository
from app.schemas.admin.auth import ResetPasswordSchema, UserRegister
from app.services.admin.user_token_service import UserTokenService
from app.services.auth_service import AuthService, UserBlockedException
from app.utils.rate_limiter import rate_limiter
from app.security.csrf import get_csrf_token

from .serializers import serialize_user

router = APIRouter(prefix='/api/v1/auth', tags=['api.v1.auth'])


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class RefreshPayload(BaseModel):
    refresh_token: str


class ForgotPasswordPayload(BaseModel):
    email: EmailStr


class FlowTokenPayload(BaseModel):
    flow_token: str


class VerifyCodePayload(FlowTokenPayload):
    code: str


class ResetPasswordPayload(FlowTokenPayload):
    password: str
    password_confirm: str


def _set_authenticated_session(request: Request, user) -> None:
    request.session.clear()
    request.session['auth_id'] = user.id
    request.session['auth_name'] = f'{user.first_name} {user.last_name}'
    request.session['auth_avatar'] = user.avatar_path
    request.session['auth_role'] = user.role.value if hasattr(user.role, 'value') else str(user.role)
    request.session['auth_session_version'] = int(user.session_version or 1)
    get_csrf_token(request)


def get_auth_service(db: AsyncSession = Depends(get_db)):
    user_repo = UserRepository(db)
    token_repo = UserTokenRepository(db)
    token_service = UserTokenService(token_repo)
    return AuthService(user_repo, token_service)


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


async def _get_session_user(request: Request, auth_service: AuthService):
    user_id = request.session.get('auth_id')
    session_version = request.session.get('auth_session_version')
    if not user_id or session_version is None:
        return None

    user = await auth_service.repository.find(int(user_id))
    if not user or not user.is_active or int(session_version) != int(user.session_version or 0):
        request.session.clear()
        return None

    return user


@router.post('/login')
async def login(
    payload: LoginPayload,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
):
    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'api_login:{client_ip}'

    attempt_count = int(await rate_limiter.increment(rl_key, settings.API_LOGIN_LOCKOUT_TTL))
    if attempt_count > settings.API_LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много попыток входа. Попробуйте позже.')

    try:
        result = await auth_service.api_authenticate(payload.email, payload.password, UserRole.GUEST, client_ip)
    except UserBlockedException as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много попыток входа. Попробуйте позже.') from exc
    if not result:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Неверный email или пароль.')

    await rate_limiter.reset(rl_key)
    user = await auth_service.repository.get_by_email(str(payload.email).strip().lower())
    _set_authenticated_session(request, user)
    return {**result, 'user': serialize_user(user)}


@router.post('/refresh')
async def refresh(
    payload: RefreshPayload,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
):
    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'api_refresh:{client_ip}'

    attempt_count = int(await rate_limiter.increment(rl_key, settings.API_REFRESH_LOCKOUT_TTL))
    if attempt_count > settings.API_REFRESH_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много попыток обновления токена.')

    result = await auth_service.api_refresh_token(payload.refresh_token)
    if not result:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Refresh token недействителен.')

    await rate_limiter.reset(rl_key)
    return result


@router.post('/register')
async def register(
    payload: UserRegister,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_service: AuthService = Depends(get_auth_service),
):
    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'register:{client_ip}'

    attempt_count = int(await rate_limiter.increment(rl_key, settings.REGISTER_LOCKOUT_TTL))
    if attempt_count > settings.REGISTER_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много попыток регистрации. Попробуйте позже.')

    _GENERIC_MSG = 'Если данные корректны, на почту отправлен код подтверждения.'
    try:
        user = await auth_service.register_user(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Ошибка регистрации. Проверьте данные.') from exc

    if user is None:
        # Existing email — respond with identical-shape generic success to avoid enumeration.
        return {
            'success': True,
            'message': _GENERIC_MSG,
            'retry_after': 60,
            'flow_token': _create_flow_token(0, 'verify_email_dummy', ttl_minutes=24 * 60),
            'user': None,
        }

    success, message, retry_after = await auth_service.send_email_verification(user, background_tasks)
    return {
        'success': True,
        'message': _GENERIC_MSG,
        'retry_after': retry_after if success else 0,
        'flow_token': _create_flow_token(user.id, 'verify_email', ttl_minutes=24 * 60),
        'user': serialize_user(user),
    }


@router.post('/forgot-password')
async def forgot_password(
    payload: ForgotPasswordPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_service: AuthService = Depends(get_auth_service),
):
    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'forgot_pwd:{client_ip}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.FORGOT_PWD_LOCKOUT_TTL))
    if attempt_count > settings.FORGOT_PWD_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много запросов. Попробуйте позже.')

    success, message, retry_after, user_id = await auth_service.forgot_password(str(payload.email), background_tasks)
    # Always return a flow_token to prevent user enumeration
    flow_token = _create_flow_token(user_id, 'reset_password', ttl_minutes=30) if user_id else _create_flow_token(0, 'reset_password_dummy', ttl_minutes=30)
    return {
        'success': success,
        'message': message,
        'retry_after': retry_after,
        'flow_token': flow_token,
    }


@router.post('/verify-code')
async def verify_code(
    payload: VerifyCodePayload,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
):
    user_id = _parse_flow_token(payload.flow_token, 'reset_password')

    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'otp_verify:{user_id}:{client_ip}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.OTP_LOCKOUT_TTL))
    if attempt_count > settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail='Слишком много попыток. Запросите новый код и попробуйте позже.',
        )

    try:
        await auth_service.verify_code_only(user_id, payload.code)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Неверный код подтверждения') from exc

    await rate_limiter.reset(rl_key)
    return {
        'verified': True,
        'verified_token': _create_flow_token(user_id, 'reset_password_verified', ttl_minutes=30),
    }


@router.post('/resend-code')
async def resend_code(
    payload: FlowTokenPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_service: AuthService = Depends(get_auth_service),
):
    user_id = _parse_flow_token(payload.flow_token, 'reset_password')

    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'resend_reset:{user_id}:{client_ip}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.FORGOT_PWD_LOCKOUT_TTL))
    if attempt_count > settings.FORGOT_PWD_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много запросов. Попробуйте позже.')

    user = await auth_service.repository.find(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Пользователь не найден.')

    success, message, retry_after, _ = await auth_service.forgot_password(user.email, background_tasks)
    return {
        'success': success,
        'message': message,
        'retry_after': retry_after,
        'flow_token': _create_flow_token(user_id, 'reset_password', ttl_minutes=30),
    }


@router.post('/reset-password')
async def reset_password(
    payload: ResetPasswordPayload,
    auth_service: AuthService = Depends(get_auth_service),
):
    user_id = _parse_flow_token(payload.flow_token, 'reset_password_verified')
    try:
        ResetPasswordSchema(password=payload.password, password_confirm=payload.password_confirm)
        await auth_service.reset_password_final(user_id, payload.password)
        return {'success': True}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Ошибка сброса пароля. Проверьте данные.') from exc


@router.post('/verify-email')
async def verify_email(
    request: Request,
    payload: VerifyCodePayload,
    auth_service: AuthService = Depends(get_auth_service),
):
    user_id = _parse_flow_token(payload.flow_token, 'verify_email')

    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'email_verify:{user_id}:{client_ip}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.OTP_LOCKOUT_TTL))
    if attempt_count > settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail='Слишком много попыток. Запросите новый код и попробуйте позже.',
        )

    try:
        await auth_service.verify_email_code(user_id, payload.code)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Ошибка верификации email') from exc

    await rate_limiter.reset(rl_key)
    user = await auth_service.repository.find(user_id)
    _set_authenticated_session(request, user)
    result = auth_service._build_api_tokens(user)
    return {**result, 'user': serialize_user(user)}


@router.post('/resend-verify-email')
async def resend_verify_email(
    payload: FlowTokenPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_service: AuthService = Depends(get_auth_service),
):
    user_id = _parse_flow_token(payload.flow_token, 'verify_email')

    client_ip = request.client.host if request.client else 'unknown'
    rl_key = f'resend_email:{user_id}:{client_ip}'
    attempt_count = int(await rate_limiter.increment(rl_key, settings.FORGOT_PWD_LOCKOUT_TTL))
    if attempt_count > settings.FORGOT_PWD_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много запросов. Попробуйте позже.')

    user = await auth_service.repository.find(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Пользователь не найден.')

    success, message, retry_after = await auth_service.send_email_verification(user, background_tasks)
    return {
        'success': success,
        'message': message,
        'retry_after': retry_after,
        'flow_token': _create_flow_token(user_id, 'verify_email', ttl_minutes=24 * 60),
    }


@router.get('/me')
async def me(current_user=Depends(auth)):
    return {'user': serialize_user(current_user)}


@router.post('/session')
async def session_login(
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
):
    from app.security.csrf import validate_csrf
    await validate_csrf(request)

    user = await _get_session_user(request, auth_service)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Нет активной серверной сессии.')

    result = auth_service._build_api_tokens(user)
    return {**result, 'user': serialize_user(user)}


@router.post('/logout')
async def logout(
    request: Request,
    current_user=Depends(auth),
    auth_service: AuthService = Depends(get_auth_service),
):
    await auth_service.revoke_all_auth_state(current_user)
    request.session.clear()
    return {'success': True}
