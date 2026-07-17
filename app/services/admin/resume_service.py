import os
import logging
import httpx
import asyncio
import easyocr
import fitz  # PyMuPDF
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sql_func

from app.models.achievement import Achievement
from app.models.user import Users
from app.models.enums import AchievementStatus
from app.config import settings

# Используем стандартный logging вместо structlog — structlog ломается
# при логировании из фоновых потоков (run_in_executor)
log = logging.getLogger("resume_service")

_ocr_reader = None


def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        model_dir = os.getenv('EASYOCR_MODEL_DIR', '/app/easyocr_models')
        download_enabled = settings.RESUME_OCR_MODEL_DOWNLOAD_ENABLED
        try:
            _ocr_reader = easyocr.Reader(
                ['ru', 'en'],
                gpu=False,
                model_storage_directory=model_dir,
                download_enabled=download_enabled,
                verbose=False
            )
            log.info("EasyOCR initialized, model_dir=%s", model_dir)
        except Exception as e:
            log.warning("EasyOCR init failed (%s), retrying offline", e)
            try:
                _ocr_reader = easyocr.Reader(
                    ['ru', 'en'],
                    gpu=False,
                    model_storage_directory=model_dir,
                    download_enabled=False,
                    verbose=False
                )
                log.info("EasyOCR initialized (offline mode)")
            except Exception as e2:
                log.error("EasyOCR init completely failed: %s", e2)
                _ocr_reader = None
                raise
    return _ocr_reader


def extract_text_from_pdf(filepath: str) -> str:
    """Извлекает текст из PDF: сначала вшитый текст, затем OCR для сканов."""
    text = ""
    with fitz.open(filepath) as doc:
        for page in doc:
            page_text = page.get_text().strip()
            if page_text:
                text += page_text + "\n"
            else:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                img_bytes = pix.tobytes("png")
                reader = get_ocr_reader()
                ocr_results = reader.readtext(img_bytes, detail=0, paragraph=True)
                text += "\n".join(ocr_results) + "\n"
    return text.strip()


def extract_text_from_image(filepath: str) -> str:
    """Извлекает текст из изображения с помощью EasyOCR."""
    reader = get_ocr_reader()
    ocr_results = reader.readtext(filepath, detail=0, paragraph=True)
    return "\n".join(ocr_results)


# Маппинг уровней для сортировки (от высшего к низшему)
LEVEL_ORDER = {
    "Международный": 5,
    "Федеральный": 4,
    "Региональный": 3,
    "Муниципальный": 2,
    "Школьный": 1,
}


class ResumeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def can_generate(self, user_id: int) -> dict:
        """Проверяет, может ли пользователь сгенерировать резюме."""
        user = await self.db.get(Users, user_id)
        if not user:
            return {"allowed": False, "reason": "Пользователь не найден."}

        count_stmt = select(sql_func.count()).select_from(Achievement).filter(
            Achievement.user_id == user_id,
            Achievement.status == AchievementStatus.APPROVED
        )
        approved_count = (await self.db.execute(count_stmt)).scalar() or 0

        if approved_count == 0:
            return {"allowed": False, "reason": "Нет подтверждённых достижений."}

        if not user.resume_generated_at:
            return {"allowed": True, "reason": None}

        new_stmt = select(sql_func.count()).select_from(Achievement).filter(
            Achievement.user_id == user_id,
            Achievement.status == AchievementStatus.APPROVED,
            Achievement.updated_at > user.resume_generated_at
        )
        new_count = (await self.db.execute(new_stmt)).scalar() or 0

        if new_count == 0:
            return {"allowed": False, "reason": "Нет новых подтверждённых документов с момента последней генерации."}

        return {"allowed": True, "reason": None}

    async def generate_resume(self, user_id: int, force_regenerate: bool = False, bypass_check: bool = False) -> dict:
        user = await self.db.get(Users, user_id)
        if not user:
            return {"success": False, "error": "Пользователь не найден."}

        if user.resume_text and not force_regenerate:
            return {"success": True, "resume": user.resume_text}

        if not bypass_check:
            check = await self.can_generate(user_id)
            if not check["allowed"]:
                return {"success": False, "error": check["reason"], "resume": user.resume_text}

        stmt = select(Achievement).filter(
            Achievement.user_id == user_id,
            Achievement.status == AchievementStatus.APPROVED
        ).order_by(Achievement.created_at.desc())
        achievements = (await self.db.execute(stmt)).scalars().all()

        if not achievements:
            return {"success": False, "error": "Нет подтвержденных достижений для генерации."}

        student_name = f"{user.first_name} {user.last_name}"

        # Собираем данные по каждому документу
        docs_data = []
        loop = asyncio.get_running_loop()

        for ach in achievements:
            doc_info = {
                "title": ach.title or "Без названия",
                "category": ach.category.value if hasattr(ach.category, 'value') else str(ach.category) if ach.category else "Другое",
                "level": ach.level.value if hasattr(ach.level, 'value') else str(ach.level) if ach.level else "Не указан",
                "description": ach.description or "",
                "points": ach.points or 0,
                "date": ach.created_at.strftime('%d.%m.%Y') if ach.created_at else "",
                "ocr_text": "",
            }

            if ach.file_path:
                full_file_path = Path("static") / ach.file_path
                ext = full_file_path.suffix.lower()

                if full_file_path.is_file():
                    if ext in ['.jpg', '.jpeg', '.png', '.webp']:
                        try:
                            doc_info["ocr_text"] = await loop.run_in_executor(
                                None, extract_text_from_image, str(full_file_path)
                            )
                        except Exception as e:
                            log.error("OCR error for image %s: %s", ach.file_path, e)
                    elif ext == '.pdf':
                        try:
                            doc_info["ocr_text"] = await loop.run_in_executor(
                                None, extract_text_from_pdf, str(full_file_path)
                            )
                        except Exception as e:
                            log.error("OCR error for PDF %s: %s", ach.file_path, e)

            docs_data.append(doc_info)

        # Пробуем локальную LLM (Qwen через vLLM), если настроена
        resume_result = None
        if settings.RESUME_LOCAL_AI_ENABLED:
            combined_text = self._build_combined_text(student_name, docs_data)
            resume_result = await self._call_local_llm(combined_text, student_name)

        # Если AI не сработал или не настроен — локальная генерация
        if not resume_result:
            resume_result = self._generate_local_resume(student_name, user, docs_data)

        user.resume_text = resume_result
        user.resume_generated_at = datetime.now(timezone.utc)
        await self.db.commit()

        return {"success": True, "resume": resume_result}

    def _build_combined_text(self, student_name: str, docs_data: list) -> str:
        """Собирает текст для отправки в AI."""
        combined = f"Студент: {student_name}\n\n"
        for doc in docs_data:
            combined += f"--- Документ ---\n"
            combined += f"Название: {doc['title']}\n"
            combined += f"Категория: {doc['category']}\n"
            combined += f"Уровень: {doc['level']}\n"
            if doc['description']:
                combined += f"Описание: {doc['description']}\n"
            if doc['ocr_text']:
                combined += f"Распознанный текст:\n{doc['ocr_text']}\n"
            combined += "\n"
        return combined

    async def _call_local_llm(self, combined_text: str, target_name: str) -> str | None:
        """Вызывает локальную LLM (Qwen2.5-7B-Instruct-AWQ через vLLM,
        OpenAI-совместимый /chat/completions). Возвращает None при ошибке."""
        payload = {
            "model": settings.LOCAL_LLM_MODEL,
            "temperature": 0.1,
            "max_tokens": 1000,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"Ты — строгий HR-специалист. "
                        f"Составь краткое профессиональное резюме для {target_name}. "
                        f"Игнорируй имена других людей в тексте документов. "
                        f"Собери достижения, определи сильные стороны и направления. "
                        f"Напиши связный текст от третьего лица (4-6 предложений). "
                        f"Не выводи сырой текст документов."
                    )
                },
                {
                    "role": "user",
                    "content": f"Данные из документов:\n{combined_text}"
                }
            ]
        }

        url = f"{settings.LOCAL_LLM_BASE_URL.rstrip('/')}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if settings.LOCAL_LLM_API_KEY:
            headers["Authorization"] = f"Bearer {settings.LOCAL_LLM_API_KEY}"

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, headers=headers, json=payload, timeout=settings.LOCAL_LLM_TIMEOUT)
                response.raise_for_status()
                result = response.json()['choices'][0]['message']['content']
                log.info("Local LLM (%s) resume generated for %s", settings.LOCAL_LLM_MODEL, target_name)
                return result
            except httpx.HTTPStatusError as e:
                log.error("Local LLM API HTTP %s: %s", e.response.status_code, e.response.text[:200])
                return None
            except Exception as e:
                log.error("Local LLM API error: %s", e)
                return None

    def _generate_local_resume(self, student_name: str, user, docs_data: list) -> str:
        """Генерирует структурированную сводку профиля на основе данных документов и OCR."""
        total = len(docs_data)
        total_points = sum(d.get("points", 0) for d in docs_data)

        # Статистика по категориям и уровням
        cat_counter = Counter(d["category"] for d in docs_data)
        level_counter = Counter(d["level"] for d in docs_data)
        best_level = max(docs_data, key=lambda d: LEVEL_ORDER.get(d["level"], 0))["level"]

        # Образование
        edu_info = ""
        if user and hasattr(user, 'education_level') and user.education_level:
            edu_val = user.education_level.value if hasattr(user.education_level, 'value') else str(user.education_level)
            course_str = f", {user.course} курс" if user.course else ""
            edu_info = f"{edu_val}{course_str}"

        parts = []

        # Заголовок
        parts.append(f"СВОДКА ПРОФИЛЯ: {student_name}")
        parts.append("=" * 40)

        # Общая информация
        if edu_info:
            parts.append(f"Обучение: {edu_info}")
        parts.append(f"Подтвержденных достижений: {total}")
        parts.append(f"Общий балл: {total_points}")
        parts.append(f"Высший уровень: {best_level}")
        parts.append("")

        # Распределение по категориям
        parts.append("ПО КАТЕГОРИЯМ:")
        for cat, count in cat_counter.most_common():
            parts.append(f"  - {cat}: {count} шт.")
        parts.append("")

        # Распределение по уровням
        parts.append("ПО УРОВНЯМ:")
        for level_name in sorted(level_counter.keys(), key=lambda x: LEVEL_ORDER.get(x, 0), reverse=True):
            count = level_counter[level_name]
            parts.append(f"  - {level_name}: {count}")
        parts.append("")

        # Список достижений с OCR-данными
        parts.append("ДОСТИЖЕНИЯ:")
        parts.append("-" * 40)

        for i, doc in enumerate(docs_data, 1):
            parts.append(f"\n{i}. {doc['title']}")
            parts.append(f"   Категория: {doc['category']} | Уровень: {doc['level']}")
            if doc.get("points"):
                parts.append(f"   Баллы: +{doc['points']}")
            if doc.get("date"):
                parts.append(f"   Дата: {doc['date']}")
            if doc.get("description"):
                parts.append(f"   Описание: {doc['description']}")

            # OCR-текст
            ocr = doc.get("ocr_text", "").strip()
            if ocr and len(ocr) > 10:
                clean_lines = [line.strip() for line in ocr.split('\n') if line.strip() and len(line.strip()) > 3]
                if clean_lines:
                    snippet = " ".join(clean_lines)
                    if len(snippet) > 300:
                        snippet = snippet[:300].rsplit(' ', 1)[0] + "..."
                    parts.append(f"   Из документа: {snippet}")

        parts.append("")
        parts.append("-" * 40)

        # Краткий вывод
        main_cats = [cat for cat, _ in cat_counter.most_common(2)]
        cats_text = " и ".join(main_cats) if main_cats else "различных направлениях"

        parts.append(
            f"Итог: {student_name} имеет {total} подтвержденных достижений "
            f"в области {cats_text.lower()}, "
            f"с максимальным уровнем \"{best_level}\" "
            f"и общим баллом {total_points}."
        )

        generated_at = datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M UTC')
        parts.append(f"\nСводка сгенерирована: {generated_at}")

        return "\n".join(parts)
