from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database import get_db
from app.middlewares.api_auth_middleware import auth
from app.models.enums import UserRole
from app.models.user import Users
from app.models.user_note import UserNote
from app.utils.access import is_in_zone, is_staff_role
from app.utils.file_validator import DOC_SIGNATURES, FileValidator
from app.utils import storage

from .serializers import serialize_user_note

router = APIRouter(prefix='/api/v1/users', tags=['api.v1.user_notes'])

_file_validator = FileValidator(
    allowed=DOC_SIGNATURES,
    max_size=settings.MAX_DOC_SIZE,
    upload_dir=settings.UPLOAD_DIR_NOTES,
)


def _require_staff(current_user=Depends(auth)):
    if current_user.role not in {UserRole.SUPER_ADMIN, UserRole.MODERATOR}:
        raise HTTPException(status_code=403, detail='Доступ запрещён')
    return current_user


async def _load_target_in_scope(user_id: int, current_user, db: AsyncSession) -> Users:
    """Return the note subject only if the staff member may act on them.

    Notes are private staff annotations about students. A moderator may only
    touch students inside their education-level/course/group scope, and never
    other staff (moderators / super admins). SUPER_ADMIN is unrestricted.
    """
    target = await db.get(Users, user_id)
    if not target or is_staff_role(getattr(target, 'role', None)):
        raise HTTPException(status_code=404, detail='Пользователь не найден')
    if not is_in_zone(current_user, target.education_level, target.course, target.study_group):
        raise HTTPException(status_code=404, detail='Пользователь не найден')
    return target


@router.get('/{user_id}/notes')
async def list_notes(
    user_id: int,
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _load_target_in_scope(user_id, current_user, db)
    stmt = (
        select(UserNote)
        .options(selectinload(UserNote.author))
        .where(UserNote.user_id == user_id)
        .order_by(UserNote.created_at.desc())
    )
    notes = (await db.execute(stmt)).scalars().all()
    return {'notes': [serialize_user_note(n) for n in notes]}


@router.post('/{user_id}/notes')
async def create_note(
    user_id: int,
    text: str = Form(..., min_length=1, max_length=5000),
    file: UploadFile | None = File(default=None),
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _load_target_in_scope(user_id, current_user, db)
    file_path: str | None = None
    if file and file.filename:
        try:
            file_path = await _file_validator.validate_and_store(file)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    note = UserNote(
        user_id=user_id,
        author_id=current_user.id,
        text=text.strip(),
        file_path=file_path,
    )
    db.add(note)
    await db.flush()
    await db.refresh(note, ['author'])
    await db.commit()
    return {'note': serialize_user_note(note)}


@router.delete('/{user_id}/notes/{note_id}')
async def delete_note(
    user_id: int,
    note_id: int,
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _load_target_in_scope(user_id, current_user, db)
    note = await db.get(UserNote, note_id)
    if not note or note.user_id != user_id:
        raise HTTPException(status_code=404, detail='Заметка не найдена')

    if note.file_path:
        if storage.is_minio_path(note.file_path):
            await storage.delete(storage.extract_key(note.file_path))

    await db.delete(note)
    await db.commit()
    return {'success': True}


@router.get('/{user_id}/notes/{note_id}/file')
async def get_note_file(
    user_id: int,
    note_id: int,
    current_user=Depends(_require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _load_target_in_scope(user_id, current_user, db)
    note = await db.get(UserNote, note_id)
    if not note or note.user_id != user_id or not note.file_path:
        raise HTTPException(status_code=404, detail='Файл не найден')

    if storage.is_minio_path(note.file_path):
        key = storage.extract_key(note.file_path)
        data = await storage.download(key)
        ext = key.rsplit('.', 1)[-1].lower() if '.' in key else ''
        media_type = 'application/pdf' if ext == 'pdf' else f'image/{ext}' if ext in ('jpg', 'jpeg', 'png', 'webp', 'gif') else 'application/octet-stream'
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media_type,
            headers={'Content-Disposition': f'inline; filename="note_{note_id}.{ext}"'},
        )

    raise HTTPException(status_code=404, detail='Файл не найден')
