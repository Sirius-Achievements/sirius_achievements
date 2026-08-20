import os

import structlog
from fastapi import UploadFile

from app.config import settings
from app.repositories.admin.achievement_repository import AchievementRepository
from app.services.admin.base_crud_service import BaseCrudService
from app.utils.file_validator import DOC_SIGNATURES, FileValidator
from app.utils import storage
from app.models.enums import AchievementStatus

logger = structlog.get_logger()


class AchievementService(BaseCrudService):
    upload_dir = "static"

    def __init__(self, repo: AchievementRepository):
        super().__init__(repo)
        self.repo = repo
        self._file_validator = FileValidator(
            allowed=DOC_SIGNATURES,
            max_size=settings.MAX_DOC_SIZE,
            upload_dir=settings.UPLOAD_DIR_ACHIEVEMENTS,
        )

    async def save_file(self, file: UploadFile) -> str:
        return await self._file_validator.validate_and_store(file)

    async def delete(
        self,
        id: int,
        user_id: int,
        user_role: str,
        actor_education_level: str | None = None,
        target_education_level: str | None = None,
    ):
        item = await self.repo.find(id)
        if not item:
            return

        is_owner = item.user_id == user_id
        role_value = getattr(user_role, "value", user_role)
        role_value = str(role_value)
        is_super_admin = role_value in ["super_admin", "SUPER_ADMIN"]
        is_moderator = role_value in ["moderator", "MODERATOR"]
        is_same_zone = (
            actor_education_level is not None
            and target_education_level is not None
            and str(actor_education_level) == str(target_education_level)
        )

        if not is_owner and not is_super_admin and not (is_moderator and is_same_zone):
            raise ValueError("У вас нет прав на удаление этого файла")

        if item.status == AchievementStatus.APPROVED or int(item.points or 0) > 0:
            await self.repo.update(id, {'status': AchievementStatus.ARCHIVED})
            return 'archived'

        if item.file_path:
            if storage.is_minio_path(item.file_path):
                await storage.delete(storage.extract_key(item.file_path))
            else:
                full_path = os.path.join("static", item.file_path)
                if os.path.exists(full_path):
                    try:
                        os.remove(full_path)
                    except OSError:
                        logger.warning("Failed to delete file", path=full_path)

        await self.repo.delete(id)
        return 'deleted'
