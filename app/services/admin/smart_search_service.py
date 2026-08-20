from __future__ import annotations

import asyncio
import json
import logging
import re

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import AchievementStatus
from app.models.user import Users
from app.utils.local_llm import call_local_llm

log = logging.getLogger("smart_search_service")

MAX_CANDIDATES = 140
CHUNK_SIZE = 10
MAX_ACHIEVEMENTS_PER_STUDENT = 4

_FALLBACK_STOP_WORDS = {
    'который', 'которые', 'студент', 'студенты', 'найти', 'покажи', 'нужны',
    'среди', 'имеет', 'имеют', 'очень', 'этого', 'этой', 'этим', 'чтобы',
}

_SYSTEM_PROMPT = (
    "Ты — ассистент поиска по базе студентов. Тебе дан список профилей студентов "
    "и критерии поиска на естественном языке.\n\n"
    "Для КАЖДОГО студента из списка коротко реши, подходит ли он под критерии, "
    "опираясь ТОЛЬКО на факты из его профиля (категории, уровни, результаты достижений, курс, группа, GPA). "
    "Не додумывай и не притягивай за уши: если в профиле нет прямого подтверждения "
    "критериям — студент НЕ подходит, даже если у него есть другие, не относящиеся к делу достижения. "
    "При отсутствии явного совпадения — не включай студента.\n\n"
    "Формат ответа:\n"
    "1) Для каждого ID отдельная строка: 'ID <номер>: да/нет — краткая причина'.\n"
    "2) Последняя строка — итог: 'ИТОГ: [список подходящих ID через запятую]'. "
    "Если никто не подходит: 'ИТОГ: []'.\n\n"
    "Пример:\n"
    "Критерии: победители олимпиад по программированию\n"
    "ID 1: Иванов — Хакатон (Хакатон, Школьный, Участник)\n"
    "ID 2: Петров — Олимпиада по информатике (Наука, Региональный, Победитель)\n"
    "Ответ:\n"
    "ID 1: нет — участие в хакатоне не то же самое, что победа в олимпиаде по программированию\n"
    "ID 2: да — победитель профильной олимпиады по информатике\n"
    "ИТОГ: [2]"
)


def _enum_value(value, default: str = "") -> str:
    if value is None:
        return default
    return value.value if hasattr(value, "value") else str(value)


def _build_profile(user: Users) -> str:
    achievements = sorted(
        [a for a in (user.achievements or []) if a.status == AchievementStatus.APPROVED],
        key=lambda a: a.points or 0,
        reverse=True,
    )[:MAX_ACHIEVEMENTS_PER_STUDENT]

    lines = [
        f"ID {user.id}: {user.first_name} {user.last_name}, "
        f"курс {user.course or '-'}, группа {user.study_group or '-'}, "
        f"уровень {_enum_value(user.education_level, '-')}, GPA {user.session_gpa or '-'}"
    ]
    if achievements:
        for achievement in achievements:
            result = _enum_value(achievement.result)
            suffix = f", {result}" if result else ""
            lines.append(
                f"  - {achievement.title or 'Без названия'} "
                f"({_enum_value(achievement.category)}, {_enum_value(achievement.level)}{suffix}, "
                f"{int(achievement.points or 0)} баллов)"
            )
    else:
        lines.append("  - подтверждённых достижений нет")

    return "\n".join(lines)


def _parse_final_verdict(content: str, valid_ids: set[int]) -> list[int] | None:
    """Итоговая строка 'ИТОГ: [...]' — самый авторитетный сигнал, когда модель
    её дописала (не оборвалась раньше). Возвращает None, если строки нет/невалидна."""
    marker = content.rfind("ИТОГ")
    if marker == -1:
        return None

    matches = re.findall(r"\[[\s\d,]*\]", content[marker:])
    if not matches:
        return None

    try:
        parsed = json.loads(matches[-1])
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, list):
        return None

    ids: list[int] = []
    seen: set[int] = set()
    for item in parsed:
        try:
            uid = int(item)
        except (TypeError, ValueError):
            continue
        if uid in valid_ids and uid not in seen:
            seen.add(uid)
            ids.append(uid)
    return ids


def _parse_line_verdicts(content: str, valid_ids: set[int]) -> list[int]:
    """Построчные вердикты 'ID <n>: ... да/нет ...' — фолбэк для случаев, когда
    модель обрывается раньше итоговой строки (типично для маленьких моделей).
    Вердикт ищется как первое отдельное слово "да"/"нет" после "ID <n>" в той же
    строке — модель не всегда пишет его сразу после двоеточия."""
    ids: list[int] = []
    seen: set[int] = set()
    for line in content.splitlines():
        id_match = re.match(r"\s*ID\s*(\d+)\b(.*)", line, re.IGNORECASE)
        if not id_match:
            continue
        verdict_match = re.search(r"\b(да|нет)\b", id_match.group(2), re.IGNORECASE)
        if not verdict_match:
            continue
        uid = int(id_match.group(1))
        if verdict_match.group(1).lower() == "да" and uid in valid_ids and uid not in seen:
            seen.add(uid)
            ids.append(uid)
    return ids


def _parse_ids(content: str, valid_ids: set[int]) -> list[int]:
    final_verdict = _parse_final_verdict(content, valid_ids)
    if final_verdict is not None:
        return final_verdict
    return _parse_line_verdicts(content, valid_ids)


def _fallback_tokens(value: str) -> set[str]:
    """Небольшой локальный индекс для разработки без запущенной vLLM.

    Сравниваем начала слов, чтобы русские падежи вроде «олимпиада/олимпиад»
    находились одинаково. Это не подменяет LLM, но сохраняет полезный поиск.
    """
    tokens = set()
    for word in re.findall(r"[a-zа-яё0-9]+", (value or '').casefold()):
        if len(word) < 4 or word in _FALLBACK_STOP_WORDS:
            continue
        tokens.add(word[:6])
    return tokens


def _fallback_haystack(user: Users) -> str:
    parts = [
        user.first_name,
        user.last_name,
        user.study_group,
        str(user.course or ''),
        _enum_value(user.education_level),
        str(user.session_gpa or ''),
    ]
    for achievement in user.achievements or []:
        if achievement.status != AchievementStatus.APPROVED:
            continue
        parts.extend([
            achievement.title,
            achievement.description,
            _enum_value(achievement.category),
            _enum_value(achievement.level),
            _enum_value(achievement.result),
        ])
    return ' '.join(str(part) for part in parts if part)


def _fallback_search(users: list[Users], description: str) -> list[int]:
    query_tokens = _fallback_tokens(description)
    if not query_tokens:
        return []

    required_matches = min(2, len(query_tokens))
    ranked: list[tuple[int, int]] = []
    for user in users:
        matches = len(query_tokens & _fallback_tokens(_fallback_haystack(user)))
        if matches >= required_matches:
            ranked.append((matches, user.id))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [user_id for _, user_id in ranked]


class SmartSearchService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.used_fallback = False

    async def search(self, stmt: Select, description: str) -> list[int] | None:
        """stmt — уже отфильтрованный select(Users) (зона модератора, роль/статус/курс).
        Возвращает упорядоченный список подходящих user_id, либо None если LLM недоступна."""
        stmt = stmt.options(selectinload(Users.achievements)).limit(MAX_CANDIDATES)
        users = (await self.db.execute(stmt)).scalars().all()
        if not users:
            return []

        chunks = [list(users[i : i + CHUNK_SIZE]) for i in range(0, len(users), CHUNK_SIZE)]
        chunk_results = await asyncio.gather(*(self._search_chunk(chunk, description) for chunk in chunks))

        if all(result is None for result in chunk_results):
            self.used_fallback = True
            log.warning("local_llm_unavailable_using_profile_search_fallback")
            return _fallback_search(list(users), description)

        matched_ids: list[int] = []
        seen: set[int] = set()
        for result in chunk_results:
            for uid in result or []:
                if uid not in seen:
                    seen.add(uid)
                    matched_ids.append(uid)

        return matched_ids

    async def _search_chunk(self, users: list[Users], description: str) -> list[int] | None:
        profiles = "\n\n".join(_build_profile(user) for user in users)
        user_prompt = f"Критерии поиска: {description}\n\nПрофили студентов:\n{profiles}"

        content = await call_local_llm(
            [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max(600, 40 * len(users)),
            temperature=0.0,
        )
        if content is None:
            return None

        return _parse_ids(content, valid_ids={user.id for user in users})
