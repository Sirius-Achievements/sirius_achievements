from __future__ import annotations

from app.models.enums import EducationLevel


AVAILABLE_EDUCATION_LEVELS = [EducationLevel.SPECIALIST.value]

COURSE_MAPPING = {
    EducationLevel.SPECIALIST.value: 3,
}

# Course number → its groups. Higher course = earlier enrolment year:
# 1 курс → ИОП-ИТ-26, 2 курс → ИОП-ИТ-25, 3 курс → ИОП-ИТ-24.
GROUP_MAPPING = {
    EducationLevel.SPECIALIST.value: {
        1: ["ИОП-ИТ-26/1", "ИОП-ИТ-26/2"],
        2: ["ИОП-ИТ-25/1", "ИОП-ИТ-25/2"],
        3: ["ИОП-ИТ-24/1", "ИОП-ИТ-24/2"],
    },
}


def groups_for(level: str | None, course: int | None = None) -> list[str]:
    if not level:
        return []

    by_course = GROUP_MAPPING.get(level, {})
    if course:
        return by_course.get(int(course), [])

    result: list[str] = []
    for groups in by_course.values():
        result.extend(groups)
    return result


def course_label(level: str | None, course: int | None) -> str:
    """Human label for a course — the group family, e.g. '3 курс' → 'ИОП-ИТ-24'."""
    if not course:
        return ''
    groups = groups_for(level or EducationLevel.SPECIALIST.value, course)
    if groups:
        return groups[0].rsplit('/', 1)[0]
    return f'{course} курс'
