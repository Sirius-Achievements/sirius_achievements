from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import func as sql_func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.achievement import Achievement
from app.models.enums import AchievementLevel, AchievementStatus
from app.models.user import Users
from app.utils import storage
from app.utils.media_paths import resolve_static_path

log = logging.getLogger("resume_service")

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SUPPORTED_OCR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
OCR_TEXT_LIMIT = 6000
PROMPT_TEXT_LIMIT = 20000
RESUME_TEXT_LIMIT = 12000

LEVEL_ORDER = {
    AchievementLevel.INTERNATIONAL.value: 5,
    AchievementLevel.FEDERAL.value: 4,
    AchievementLevel.REGIONAL.value: 3,
    AchievementLevel.MUNICIPAL.value: 2,
    AchievementLevel.SCHOOL.value: 1,
}


def sanitize_resume_text(value: str | None, max_length: int | None = None) -> str:
    if not value:
        return ""

    cleaned = value.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _CONTROL_CHARS_RE.sub("", cleaned)
    cleaned = "\n".join(line.rstrip() for line in cleaned.split("\n"))
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    if max_length and len(cleaned) > max_length:
        shortened = cleaned[:max_length].rstrip()
        last_space = shortened.rfind(" ")
        if last_space > max_length * 0.7:
            shortened = shortened[:last_space].rstrip()
        cleaned = shortened

    return cleaned


def _enum_value(value: object | None, default: str) -> str:
    if value is None:
        return default
    return value.value if hasattr(value, "value") else str(value)


async def _ocr_via_service(file_bytes: bytes, filename: str) -> str:
    url = f"{settings.AI_SERVICE_URL.rstrip('/')}/ocr"
    try:
        async with httpx.AsyncClient(timeout=settings.AI_SERVICE_TIMEOUT) as client:
            response = await client.post(url, files={"file": (filename, file_bytes)})
            response.raise_for_status()
            payload = response.json()
            return sanitize_resume_text(str(payload.get("text", "")), max_length=OCR_TEXT_LIMIT)
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:200] if exc.response is not None else ""
        log.error("AI service OCR HTTP %s for %s: %s", exc.response.status_code, filename, body)
    except Exception:
        log.exception("AI service OCR call failed for %s", filename)
    return ""


class ResumeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def can_generate(self, user_id: int) -> dict:
        user = await self.db.get(Users, user_id)
        if not user:
            return {"allowed": False, "reason": "Пользователь не найден."}

        count_stmt = select(sql_func.count()).select_from(Achievement).filter(
            Achievement.user_id == user_id,
            Achievement.status == AchievementStatus.APPROVED,
        )
        approved_count = (await self.db.execute(count_stmt)).scalar() or 0

        if approved_count == 0:
            return {"allowed": False, "reason": "Нет подтвержденных достижений."}

        if not user.resume_generated_at:
            return {"allowed": True, "reason": None}

        new_stmt = select(sql_func.count()).select_from(Achievement).filter(
            Achievement.user_id == user_id,
            Achievement.status == AchievementStatus.APPROVED,
            Achievement.updated_at > user.resume_generated_at,
        )
        new_count = (await self.db.execute(new_stmt)).scalar() or 0

        if new_count == 0:
            return {
                "allowed": False,
                "reason": "Нет новых подтвержденных документов с момента последней генерации.",
            }

        return {"allowed": True, "reason": None}

    async def generate_resume(
        self,
        user_id: int,
        force_regenerate: bool = False,
        bypass_check: bool = False,
    ) -> dict:
        try:
            user = await self.db.get(Users, user_id)
            if not user:
                return {"success": False, "error": "Пользователь не найден.", "status_code": 404}

            if user.resume_text and not force_regenerate:
                return {
                    "success": True,
                    "resume": sanitize_resume_text(user.resume_text, max_length=RESUME_TEXT_LIMIT),
                }

            if not bypass_check:
                check = await self.can_generate(user_id)
                if not check["allowed"]:
                    return {"success": False, "error": check["reason"], "status_code": 429}

            stmt = (
                select(Achievement)
                .filter(
                    Achievement.user_id == user_id,
                    Achievement.status == AchievementStatus.APPROVED,
                )
                .order_by(Achievement.created_at.desc())
            )
            achievements = (await self.db.execute(stmt)).scalars().all()

            if not achievements:
                return {
                    "success": False,
                    "error": "Нет подтвержденных достижений для генерации.",
                    "status_code": 429,
                }

            student_meta = self._build_student_meta(user)
            docs_data: list[dict[str, object]] = []

            for achievement in achievements:
                document_data = self._build_document_data(achievement)
                file_path = document_data.get("file_path")
                if isinstance(file_path, str) and file_path:
                    document_data["ocr_text"] = await self._extract_ocr_text(file_path)
                docs_data.append(document_data)

            resume_result: str | None = None
            if self._is_external_ai_configured():
                combined_text = self._build_combined_text(student_meta, docs_data)
                if combined_text:
                    resume_result = await self._call_yandex_gpt(combined_text, student_meta)

            if not resume_result:
                resume_result = self._generate_local_resume(student_meta["full_name"], user, docs_data)

            resume_result = sanitize_resume_text(resume_result, max_length=RESUME_TEXT_LIMIT)
            if not resume_result:
                return {
                    "success": False,
                    "error": "Не удалось собрать текст резюме по документам.",
                    "status_code": 500,
                }

            user.resume_text = resume_result
            user.resume_generated_at = datetime.now(timezone.utc)
            await self.db.commit()
            await self.db.refresh(user)

            return {"success": True, "resume": resume_result}
        except Exception:
            await self.db.rollback()
            log.exception("Resume generation failed for user_id=%s", user_id)
            return {
                "success": False,
                "error": "Не удалось сгенерировать резюме из-за внутренней ошибки.",
                "status_code": 500,
            }

    def _build_student_meta(self, user: Users) -> dict[str, str]:
        full_name = sanitize_resume_text(
            f"{getattr(user, 'last_name', '') or ''} {getattr(user, 'first_name', '') or ''}".strip(),
            max_length=200,
        ) or "Студент"

        education_value = _enum_value(getattr(user, "education_level", None), "")
        course_value = str(getattr(user, "course", "") or "")
        group_value = sanitize_resume_text(getattr(user, "study_group", "") or "", max_length=64)
        gpa_value = sanitize_resume_text(getattr(user, "session_gpa", "") or "", max_length=16)

        return {
            "full_name": full_name,
            "course": course_value or "-",
            "group": group_value or "-",
            "specialty": settings.RESUME_SPECIALTY_DEFAULT if not education_value else education_value,
            "qualification": settings.RESUME_QUALIFICATION_DEFAULT,
            "gpa": gpa_value or "-",
            "supervisor": settings.RESUME_SUPERVISOR,
        }

    def _build_document_data(self, achievement: Achievement) -> dict[str, object]:
        title = sanitize_resume_text(achievement.title or "Без названия", max_length=200) or "Без названия"
        description = sanitize_resume_text(achievement.description or "", max_length=1200)

        return {
            "title": title,
            "category": _enum_value(achievement.category, "Другое"),
            "level": _enum_value(achievement.level, "Не указан"),
            "result": _enum_value(getattr(achievement, "result", None), ""),
            "description": description,
            "points": int(achievement.points or 0),
            "date": achievement.created_at.strftime("%d.%m.%Y") if achievement.created_at else "",
            "ocr_text": "",
            "file_path": achievement.file_path or "",
        }

    async def _extract_ocr_text(self, file_path: str) -> str:
        normalized_path = file_path.replace("\\", "/")
        source_for_extension = (
            storage.extract_key(normalized_path) if storage.is_minio_path(normalized_path) else normalized_path
        )
        extension = Path(source_for_extension).suffix.lower()
        if extension not in SUPPORTED_OCR_EXTENSIONS:
            return ""

        try:
            if storage.is_minio_path(normalized_path):
                object_key = storage.extract_key(normalized_path)
                file_bytes = await storage.download(object_key)
                filename = Path(object_key).name or f"file{extension}"
            else:
                relative_path = normalized_path.lstrip("/")
                if relative_path.startswith("static/"):
                    relative_path = relative_path[len("static/") :]
                source_path = resolve_static_path(relative_path)
                if not source_path.exists() or not source_path.is_file():
                    log.warning("Resume source file not found: %s", file_path)
                    return ""
                file_bytes = source_path.read_bytes()
                filename = source_path.name

            if not file_bytes:
                return ""

            return await _ocr_via_service(file_bytes, filename)
        except Exception:
            log.exception("Failed to extract OCR text for %s", file_path)
            return ""

    def _is_external_ai_configured(self) -> bool:
        api_key = settings.YANDEX_API_KEY or ""
        folder_id = settings.YANDEX_FOLDER_ID or ""
        has_placeholders = api_key.lower().startswith("your") or folder_id.lower().startswith("your")
        return bool(settings.RESUME_EXTERNAL_AI_ENABLED and api_key and folder_id and not has_placeholders)

    def _build_combined_text(self, student_meta: dict[str, str], docs_data: list[dict[str, object]]) -> str:
        parts = [
            "Данные студента:",
            f"ФИО: {student_meta['full_name']}",
            f"Курс: {student_meta['course']}",
            f"Группа: {student_meta['group']}",
            f"Специальность: {student_meta['specialty']}",
            f"Квалификация: {student_meta['qualification']}",
            f"Средний балл: {student_meta['gpa']}",
            f"Научный руководитель: {student_meta['supervisor']}",
        ]

        for document in docs_data:
            parts.append("\n--- Подтвержденный документ ---")
            parts.append(f"Название: {document['title']}")
            parts.append(f"Категория: {document['category']}")
            parts.append(f"Уровень: {document['level']}")
            if document.get("result"):
                parts.append(f"Результат: {document['result']}")

            description = sanitize_resume_text(str(document.get("description", "")), max_length=800)
            if description:
                parts.append(f"Описание: {description}")

            ocr_text = sanitize_resume_text(str(document.get("ocr_text", "")), max_length=1200)
            if ocr_text:
                parts.append(f"Распознанный текст документа: {ocr_text}")

        return sanitize_resume_text("\n".join(parts), max_length=PROMPT_TEXT_LIMIT)

    async def _call_yandex_gpt(self, combined_text: str, student_meta: dict[str, str]) -> str | None:
        api_key = settings.YANDEX_API_KEY
        folder_id = settings.YANDEX_FOLDER_ID
        if not api_key or not folder_id:
            return None

        system_prompt = (
            "Ты составляешь официальную характеристику-рекомендацию студента на русском языке. "
            "Используй стиль и структуру образца: заголовок 'ХАРАКТЕРИСТИКА-РЕКОМЕНДАЦИЯ', затем поля "
            "ФИО студента, курс и группа, специальность, квалификация, средний балл. Далее 2-4 абзаца "
            "о качествах студента и его подтвержденных достижениях. После этого добавь список наиболее "
            "значимых достижений и строку 'Научный руководитель ...'. "
            "Не выдумывай факты, даты, должности, публикации или победы. Если данных мало, пиши нейтрально. "
            "Не называй текст коммерческим резюме, CV или анкетой."
        )
        user_prompt = (
            "Составь характеристику-рекомендацию строго по шаблону. "
            "ФИО, курс, группа, специальность, квалификация, средний балл и научного руководителя бери из данных ниже. "
            f"\n\n{combined_text}"
        )
        prompt = {
            "modelUri": f"gpt://{folder_id}/yandexgpt",
            "completionOptions": {
                "stream": False,
                "temperature": 0.15,
                "maxTokens": "1800",
            },
            "messages": [
                {"role": "system", "text": system_prompt},
                {"role": "user", "text": user_prompt},
            ],
        }

        url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
        headers = {"Content-Type": "application/json", "Authorization": f"Api-Key {api_key}"}

        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                response = await client.post(url, headers=headers, json=prompt)
                response.raise_for_status()
                payload = response.json()
                result = (
                    payload.get("result", {})
                    .get("alternatives", [{}])[0]
                    .get("message", {})
                    .get("text", "")
                )
                sanitized = sanitize_resume_text(result, max_length=RESUME_TEXT_LIMIT)
                if sanitized:
                    log.info("YandexGPT resume generated for %s", student_meta["full_name"])
                    return sanitized
            except httpx.HTTPStatusError as exc:
                response_text = exc.response.text[:200] if exc.response is not None else ""
                log.error("YandexGPT API HTTP %s: %s", exc.response.status_code, response_text)
            except Exception:
                log.exception("YandexGPT API error for %s", student_meta["full_name"])

        return None

    def _generate_local_resume(
        self,
        student_name: str,
        user: Users,
        docs_data: list[dict[str, object]],
    ) -> str:
        student_meta = self._build_student_meta(user)
        total = len(docs_data)
        total_points = sum(int(document.get("points", 0) or 0) for document in docs_data)
        category_counter = Counter(str(document.get("category", "Другое")) for document in docs_data)
        best_document = max(
            docs_data,
            key=lambda document: LEVEL_ORDER.get(str(document.get("level", "")), 0),
        )
        best_level = str(best_document.get("level", AchievementLevel.SCHOOL.value))
        main_categories = [category for category, _ in category_counter.most_common(2)]
        categories_text = " и ".join(main_categories).lower() if main_categories else "проектной деятельности"

        achievement_lines = []
        for document in docs_data[:8]:
            title = str(document.get("title", "Без названия"))
            level = str(document.get("level", "Не указан"))
            result = str(document.get("result", "") or "")
            date = str(document.get("date", "") or "")
            suffix_parts = [part for part in (result, level, date) if part]
            suffix = f" ({', '.join(suffix_parts)})" if suffix_parts else ""
            achievement_lines.append(f"- {title}{suffix};")

        if achievement_lines:
            achievement_lines[-1] = achievement_lines[-1].rstrip(";") + "."

        intro = (
            f"За время обучения {student_name} зарекомендовал себя как ответственный, "
            "целеустремленный и дисциплинированный студент. Он активно вовлечен в учебную, "
            f"проектную и исследовательскую деятельность, уделяет внимание направлению {categories_text}."
        )
        achievements_summary = (
            f"{student_name} имеет {total} подтвержденных достижений с максимальным уровнем "
            f"'{best_level}' и суммарным рейтингом {total_points} баллов. Представленные документы "
            "подтверждают устойчивый интерес студента к профессиональному развитию и готовность "
            "участвовать в мероприятиях разного уровня."
        )
        recommendation = (
            f"{student_name} успешно совмещает обучение с участием в конкурсах, проектах и иных "
            "мероприятиях. Может быть рекомендован для дальнейшего участия в научной, проектной "
            "и грантовой деятельности образовательной организации."
        )

        parts = [
            "ХАРАКТЕРИСТИКА-РЕКОМЕНДАЦИЯ",
            "",
            f"ФИО студента: {student_meta['full_name']}",
            f"Курс: {student_meta['course']}, группа: {student_meta['group']}",
            f"Специальность: {student_meta['specialty']}",
            f"Квалификация: {student_meta['qualification']}",
            f"Средний балл: {student_meta['gpa']}",
            "",
            intro,
            "",
            achievements_summary,
            "",
            f"{student_name} успешно совмещает учебу с участием в интеллектуальных соревнованиях, проектах и мероприятиях:",
            *achievement_lines,
            "",
            recommendation,
            "",
            f"Научный руководитель\t\t\t\t{student_meta['supervisor']}",
        ]

        return sanitize_resume_text("\n".join(parts), max_length=RESUME_TEXT_LIMIT)
