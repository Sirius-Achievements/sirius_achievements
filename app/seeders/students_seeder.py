"""Seeder: six specialist groups with diverse achievements and fake document files."""

import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.achievement import Achievement
from app.models.enums import (
    AchievementCategory,
    AchievementLevel,
    AchievementStatus,
    EducationLevel,
    UserRole,
    UserStatus,
)
from app.models.user import Users

from app.utils.password import hash_password
from app.utils.education import groups_for

# ── Данные для генерации ──

FIRST_NAMES_M = [
    "Александр", "Дмитрий", "Максим", "Иван", "Артём", "Никита", "Михаил",
    "Даниил", "Егор", "Андрей", "Кирилл", "Илья", "Роман", "Тимофей",
    "Матвей", "Сергей", "Павел", "Владислав", "Денис", "Олег",
]
FIRST_NAMES_F = [
    "Анна", "Мария", "Елена", "Дарья", "Софья", "Алиса", "Полина",
    "Виктория", "Екатерина", "Ольга", "Наталья", "Татьяна", "Ксения",
    "Валерия", "Юлия", "Ирина", "Светлана", "Анастасия", "Маргарита", "Вера",
]
LAST_NAMES_M = [
    "Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов",
    "Новиков", "Морозов", "Волков", "Соловьёв", "Козлов", "Лебедев",
    "Фёдоров", "Михайлов", "Зайцев", "Павлов", "Семёнов", "Голубев",
    "Виноградов", "Богданов",
]
LAST_NAMES_F = [
    "Иванова", "Петрова", "Сидорова", "Кузнецова", "Смирнова", "Попова",
    "Новикова", "Морозова", "Волкова", "Соловьёва", "Козлова", "Лебедева",
    "Фёдорова", "Михайлова", "Зайцева", "Павлова", "Семёнова", "Голубева",
    "Виноградова", "Богданова",
]

ACHIEVEMENT_TITLES = {
    AchievementCategory.SPORT: [
        "Победа в соревнованиях по плаванию",
        "Призёр турнира по шахматам",
        "Первое место по лёгкой атлетике",
        "Серебро на чемпионате по волейболу",
        "Участие в марафоне",
        "Победитель турнира по баскетболу",
        "Бронза на соревнованиях по дзюдо",
        "Кубок по настольному теннису",
    ],
    AchievementCategory.SCIENCE: [
        "Победа на олимпиаде по математике",
        "Призёр олимпиады по физике",
        "Участие в конференции по биологии",
        "Публикация научной статьи",
        "Диплом олимпиады по информатике",
        "Победитель хакатона",
        "Призёр олимпиады по химии",
        "Грант на научное исследование",
    ],
    AchievementCategory.ART: [
        "Лауреат конкурса вокалистов",
        "Победа в конкурсе живописи",
        "Участие в театральном фестивале",
        "Диплом музыкального конкурса",
        "Призёр фотоконкурса",
        "Выставка графических работ",
        "Победитель конкурса дизайна",
        "Лауреат литературного конкурса",
    ],
    AchievementCategory.VOLUNTEERING: [
        "Волонтёр на экологической акции",
        "Помощь в приюте для животных",
        "Организация донорской акции",
        "Участие в благотворительном забеге",
        "Волонтёр на городском мероприятии",
        "Координатор волонтёрского отряда",
        "Благотворительный сбор средств",
        "Помощь ветеранам",
    ],
    AchievementCategory.HACKATHON: [
        "Победитель хакатона по ИИ",
        "Призёр хакатона по веб-разработке",
        "Участие в хакатоне по кибербезопасности",
        "Финалист хакатона по мобильной разработке",
        "Победа на хакатоне по IoT",
        "Призёр хакатона по Data Science",
        "Участие в хакатоне по блокчейну",
        "Победитель студенческого хакатона",
    ],
    AchievementCategory.OTHER: [
        "Сертификат курсов по Python",
        "Диплом языковой школы",
        "Стажировка в IT-компании",
        "Сертификат по управлению проектами",
        "Курс по финансовой грамотности",
        "Диплом автошколы",
        "Онлайн-курс по Data Science",
        "Сертификат First Certificate in English",
    ],
    AchievementCategory.PATRIOTISM: [
        "Участие в акции Бессмертный полк",
        "Волонтёр на параде Победы",
        "Победитель конкурса патриотической песни",
        "Участие в военно-патриотических сборах",
        "Призёр конкурса сочинений о ветеранах",
        "Организатор памятного мероприятия",
        "Участие в поисковом отряде",
        "Диплом конкурса патриотического плаката",
    ],
    AchievementCategory.PROJECTS: [
        "Победитель конкурса стартапов",
        "Призёр конкурса социальных проектов",
        "Реализация студенческого проекта",
        "Грант на реализацию проекта",
        "Финалист конкурса бизнес-идей",
        "Победитель конкурса инновационных проектов",
        "Участник акселератора стартапов",
        "Диплом конкурса проектных инициатив",
    ],
}

DESCRIPTIONS = {
    AchievementCategory.SPORT: "Спортивное достижение, подтверждённое грамотой/дипломом.",
    AchievementCategory.SCIENCE: "Научное/академическое достижение, подтверждённое дипломом.",
    AchievementCategory.ART: "Творческое достижение, подтверждённое дипломом/сертификатом.",
    AchievementCategory.VOLUNTEERING: "Волонтёрская деятельность, подтверждённая справкой.",
    AchievementCategory.HACKATHON: "Участие в хакатоне, подтверждённое дипломом/сертификатом.",
    AchievementCategory.OTHER: "Дополнительное достижение, подтверждённое сертификатом.",
    AchievementCategory.PATRIOTISM: "Патриотическая деятельность, подтверждённая справкой/дипломом.",
    AchievementCategory.PROJECTS: "Проектная деятельность, подтверждённая дипломом/сертификатом.",
}

LEVELS = list(AchievementLevel)
CATEGORIES = list(AchievementCategory)
STATUSES_WEIGHTED = (
    [AchievementStatus.APPROVED] * 5
    + [AchievementStatus.PENDING] * 3
    + [AchievementStatus.REJECTED] * 1
    + [AchievementStatus.REVISION] * 1
)

POINTS_BY_LEVEL = {
    AchievementLevel.SCHOOL: (5, 15),
    AchievementLevel.MUNICIPAL: (10, 25),
    AchievementLevel.REGIONAL: (20, 40),
    AchievementLevel.FEDERAL: (30, 60),
    AchievementLevel.INTERNATIONAL: (50, 100),
}


def _make_stub_file(directory: str, filename: str) -> str:
    """Create a small stub PDF so file_path points to a real file."""
    Path(directory).mkdir(parents=True, exist_ok=True)
    path = os.path.join(directory, filename)
    if not os.path.exists(path):
        # Minimal valid PDF
        with open(path, "wb") as f:
            f.write(
                b"%PDF-1.0\n1 0 obj<</Pages 2 0 R>>endobj\n"
                b"2 0 obj<</Kids[3 0 R]/Count 1>>endobj\n"
                b"3 0 obj<</MediaBox[0 0 612 792]>>endobj\n"
                b"trailer<</Root 1 0 R>>\n%%EOF\n"
            )
    return path


# The actual programme has three cohorts, two study groups each.
SPECIALIST_COURSES = (1, 2, 3)
STUDENTS_PER_GROUP = 25


class StudentsSeeder:
    @staticmethod
    async def run(db: AsyncSession, *, moderator_id: int | None = None):
        upload_dir = "static/uploads/achievements"
        now = datetime.now(timezone.utc)
        hashed = hash_password("Password123!")
        students_created = 0
        achievements_created = 0

        for course in SPECIALIST_COURSES:
            for group in groups_for(EducationLevel.SPECIALIST.value, course):
                group_slug = group.lower().replace("-", "").replace("/", "g")
                existing = await db.execute(
                    select(Users).where(
                        Users.role == UserRole.STUDENT.value,
                        Users.email.like(f"seed.specialist.{group_slug}.%@example.com"),
                    )
                )
                already = len(existing.scalars().all())
                remaining = STUDENTS_PER_GROUP - already
                if remaining <= 0:
                    print(f"   Skipping {group} (already {already} seeded)")
                    continue

                print(f"   Seeding {remaining} students for {group}...")
                for i in range(already + 1, already + remaining + 1):
                    is_female = random.random() < 0.5
                    if is_female:
                        first = random.choice(FIRST_NAMES_F)
                        last = random.choice(LAST_NAMES_F)
                    else:
                        first = random.choice(FIRST_NAMES_M)
                        last = random.choice(LAST_NAMES_M)

                    student = Users(
                        email=f"seed.specialist.{group_slug}.{i:03d}@example.com",
                        hashed_password=hashed,
                        first_name=first,
                        last_name=last,
                        role=UserRole.STUDENT.value,
                        status=UserStatus.ACTIVE.value,
                        education_level=EducationLevel.SPECIALIST.value,
                        course=course,
                        study_group=group,
                        is_active=True,
                        created_at=now - timedelta(days=random.randint(30, 365)),
                    )
                    db.add(student)
                    await db.flush()
                    students_created += 1

                    for _ in range(random.randint(1, 8)):
                        cat = random.choice(CATEGORIES)
                        level = random.choice(LEVELS)
                        ach_status = random.choice(STATUSES_WEIGHTED)
                        lo, hi = POINTS_BY_LEVEL[level]
                        points = random.randint(lo, hi) if ach_status == AchievementStatus.APPROVED else 0

                        filename = f"seed_{student.id}_{achievements_created + 1}.pdf"
                        _make_stub_file(upload_dir, filename)

                        ach = Achievement(
                            user_id=student.id,
                            title=random.choice(ACHIEVEMENT_TITLES[cat]),
                            description=DESCRIPTIONS[cat],
                            file_path=f"achievements/{filename}",
                            category=cat.name,
                            level=level.name,
                            points=points,
                            status=ach_status.name,
                            moderator_id=moderator_id if ach_status != AchievementStatus.PENDING else None,
                            created_at=now - timedelta(days=random.randint(1, 300)),
                        )
                        db.add(ach)
                        achievements_created += 1

                await db.commit()
                print(f"   {group}: done")

        print(f"   Total created: {students_created} students, {achievements_created} achievements")
        print("   All student passwords: Password123!")
