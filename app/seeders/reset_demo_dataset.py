from __future__ import annotations

import asyncio
import base64
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from sqlalchemy import delete, select, text

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings
from app.infrastructure.database import Base, async_session_maker, engine
from app.models.achievement import Achievement
from app.models.audit_log import AuditLog
from app.models.enums import (
    AchievementCategory,
    AchievementLevel,
    AchievementResult,
    AchievementStatus,
    EducationLevel,
    SupportTicketStatus,
    UserRole,
    UserStatus,
)
from app.models.notification import Notification
from app.models.season_result import SeasonResult
from app.models.support_message import SupportMessage
from app.models.support_ticket import SupportTicket
from app.models.user import Users
from app.models.user_note import UserNote
from app.models.user_token import UserToken
from app.services.points_calculator import calculate_points
from app.utils import storage
from app.utils.education import COURSE_MAPPING, groups_for

SPECIALIST_COURSES = list(range(1, COURSE_MAPPING[EducationLevel.SPECIALIST.value] + 1))
from app.utils.password import hash_password


COMMON_PASSWORD = "Sirius123!"
SUPER_ADMIN_EMAIL = "super.admin@example.com"
MODERATOR_EMAIL = "moderator@example.com"

ACTIVE_STUDENTS_PER_COURSE = 50
DELETED_STUDENTS_COUNT = 6
PENDING_APPLICATIONS_COUNT = 20
ASSIGNED_PENDING_APPLICATIONS = 10
INCOMING_PENDING_DOCUMENTS = 20
ASSIGNED_PENDING_DOCUMENTS = 20
OPEN_SUPPORT_TICKETS = 20
IN_PROGRESS_SUPPORT_TICKETS = 20
CLOSED_SUPPORT_TICKETS = 12

DEMO_EMAIL_DOMAIN = (settings.MAIL_FROM.split("@")[-1] if settings.MAIL_FROM and "@" in settings.MAIL_FROM else "example.com")

PDF_BYTES = (
    b"%PDF-1.0\n"
    b"1 0 obj<</Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAMUlEQVR42u3PAQ0AAAgDIN8/9K3h"
    "HFQgG2Qyk8lkMplMJpPJZDKZTCaTyWQymUwmk8lkMln8G2oAAS+Vj0cAAAAASUVORK5CYII="
)

FIRST_NAMES = [
    "Алексей", "Мария", "Дмитрий", "Екатерина", "Андрей", "Ольга", "Сергей", "Анна", "Павел", "Наталья",
    "Игорь", "Татьяна", "Максим", "Юлия", "Роман", "Артём", "Виктория", "Кирилл", "Елена", "Денис",
    "Алина", "Никита", "Дарья", "Владислав", "Полина", "Глеб", "Вероника", "Тимур", "Карина", "Илья",
]

LAST_NAMES = [
    "Иванов", "Петрова", "Сидоров", "Козлова", "Новиков", "Морозова", "Волков", "Лебедева", "Соколов", "Кузнецова",
    "Попов", "Васильева", "Зайцев", "Павлова", "Семёнов", "Белов", "Громова", "Орлов", "Фёдорова", "Щербаков",
    "Тарасова", "Жуков", "Крылова", "Егорова", "Антонов", "Степанова", "Филиппов", "Комарова", "Захаров", "Данилова",
]

DOCUMENT_TOPICS = [
    "Олимпиада по специальности",
    "Научная конференция факультета",
    "Практический кейс-чемпионат",
    "Волонтёрский проект семестра",
    "Хакатон по цифровым сервисам",
    "Проектная сессия кафедры",
    "Патриотическая акция института",
    "Спортивный турнир кампуса",
]

SUPPORT_SUBJECTS = [
    "Не вижу баллы после проверки документа",
    "Нужно заменить прикреплённый файл",
    "Не могу открыть превью достижения",
    "Баллы не совпадают с таблицей начислений",
    "Нужно изменить группу в профиле",
    "Документ слишком долго висит на проверке",
    "Не понимаю причину возврата документа",
    "Не отображается ссылка на подтверждение",
    "Ошибка при отправке нового обращения",
    "Не вижу чат поддержки в списке",
]

RESULTS = [
    AchievementResult.PARTICIPANT,
    AchievementResult.PRIZEWINNER,
    AchievementResult.WINNER,
]

LEVELS = [
    AchievementLevel.SCHOOL,
    AchievementLevel.MUNICIPAL,
    AchievementLevel.REGIONAL,
    AchievementLevel.FEDERAL,
    AchievementLevel.INTERNATIONAL,
]

CATEGORIES = [
    AchievementCategory.SPORT,
    AchievementCategory.SCIENCE,
    AchievementCategory.ART,
    AchievementCategory.VOLUNTEERING,
    AchievementCategory.HACKATHON,
    AchievementCategory.PATRIOTISM,
    AchievementCategory.PROJECTS,
    AchievementCategory.OTHER,
]

ALTER_STATEMENTS = [
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ",
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ",
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ",
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_access_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_refresh_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS study_group VARCHAR",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_gpa VARCHAR",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS moderator_courses VARCHAR",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS moderator_groups VARCHAR",
    "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS external_url VARCHAR",
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'achievementresult') THEN CREATE TYPE achievementresult AS ENUM ('PARTICIPANT', 'PRIZEWINNER', 'WINNER'); END IF; END $$",
    "ALTER TABLE achievements ADD COLUMN IF NOT EXISTS result achievementresult",
]

ENUM_ADDITIONS = [
    "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'HACKATHON'",
    "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'PATRIOTISM'",
    "ALTER TYPE achievementcategory ADD VALUE IF NOT EXISTS 'PROJECTS'",
    "ALTER TYPE achievementstatus ADD VALUE IF NOT EXISTS 'REVISION'",
    "ALTER TYPE achievementstatus ADD VALUE IF NOT EXISTS 'ARCHIVED'",
    "ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'REJECTED'",
    "ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'DELETED'",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'GUEST'",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'STUDENT'",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'MODERATOR'",
    "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'PARTICIPANT'",
    "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'PRIZEWINNER'",
    "ALTER TYPE achievementresult ADD VALUE IF NOT EXISTS 'WINNER'",
]


@dataclass(slots=True)
class UploadedAsset:
    path: str
    url: str


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


async def ensure_demo_schema() -> None:
    async with engine.begin() as conn:
        for stmt in ENUM_ADDITIONS:
            try:
                async with conn.begin_nested():
                    await conn.execute(text(stmt))
            except Exception:
                pass

        enum_check = await conn.execute(
            text(
                "SELECT enumlabel FROM pg_enum "
                "JOIN pg_type ON pg_enum.enumtypid = pg_type.oid "
                "WHERE pg_type.typname = 'supportticketstatus' ORDER BY enumsortorder"
            )
        )
        existing_labels = [row[0] for row in enum_check.fetchall()]
        expected_labels = ["open", "in_progress", "closed"]
        if existing_labels and existing_labels != expected_labels:
            await conn.execute(text("ALTER TABLE support_tickets ALTER COLUMN status DROP DEFAULT"))
            await conn.execute(text("ALTER TABLE support_tickets ALTER COLUMN status TYPE VARCHAR(20)"))
            await conn.execute(text("UPDATE support_tickets SET status = LOWER(status)"))
            await conn.execute(text("DROP TYPE IF EXISTS supportticketstatus"))
            await conn.execute(text("CREATE TYPE supportticketstatus AS ENUM ('open', 'in_progress', 'closed')"))
            await conn.execute(
                text(
                    "ALTER TABLE support_tickets ALTER COLUMN status TYPE supportticketstatus "
                    "USING status::supportticketstatus"
                )
            )
            await conn.execute(text("ALTER TABLE support_tickets ALTER COLUMN status SET DEFAULT 'open'"))

        await conn.run_sync(Base.metadata.create_all)

        for stmt in ALTER_STATEMENTS:
            try:
                async with conn.begin_nested():
                    await conn.execute(text(stmt))
            except Exception:
                pass


async def cleanup_demo_objects() -> None:
    await storage.ensure_bucket()

    def _delete() -> None:
        client = _s3_client()
        for prefix in ("achievements/demo_seed/", "support/demo_seed/"):
            continuation_token = None
            while True:
                params = {"Bucket": settings.MINIO_BUCKET, "Prefix": prefix, "MaxKeys": 1000}
                if continuation_token:
                    params["ContinuationToken"] = continuation_token
                try:
                    response = client.list_objects_v2(**params)
                except ClientError:
                    break
                contents = response.get("Contents", [])
                if contents:
                    client.delete_objects(
                        Bucket=settings.MINIO_BUCKET,
                        Delete={"Objects": [{"Key": item["Key"]} for item in contents]},
                    )
                if not response.get("IsTruncated"):
                    break
                continuation_token = response.get("NextContinuationToken")

    await asyncio.to_thread(_delete)


async def make_presigned_url(key: str) -> str:
    def _generate() -> str:
        client = _s3_client()
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.MINIO_BUCKET, "Key": key},
                ExpiresIn=60 * 60 * 24 * 365,
            )
        except Exception:
            endpoint = settings.MINIO_ENDPOINT.rstrip("/")
            return f"{endpoint}/{settings.MINIO_BUCKET}/{key}"

    return await asyncio.to_thread(_generate)


async def upload_demo_asset(kind: str, stem: str, *, image: bool = False) -> UploadedAsset:
    ext = "png" if image else "pdf"
    content_type = "image/png" if image else "application/pdf"
    payload = PNG_BYTES if image else PDF_BYTES
    key = f"{kind}/demo_seed/{uuid.uuid4().hex}_{stem}.{ext}"
    path = await storage.upload(payload, key, content_type)
    url = await make_presigned_url(key)
    return UploadedAsset(path=path, url=url)


def build_name(index: int) -> tuple[str, str]:
    return FIRST_NAMES[index % len(FIRST_NAMES)], LAST_NAMES[(index * 3) % len(LAST_NAMES)]


def build_active_email(course: int, group: str, index: int) -> str:
    group_code = "".join(char for char in group if char.isdigit()) or f"{course}00"
    return f"specialist.c{course}.g{group_code}.{index:03d}@{DEMO_EMAIL_DOMAIN}"


def build_deleted_email(index: int) -> str:
    return f"deleted.student{index:03d}@{DEMO_EMAIL_DOMAIN}"


def build_pending_email(index: int) -> str:
    return f"pending.student{index:03d}@{DEMO_EMAIL_DOMAIN}"


def build_document_title(index: int, category: AchievementCategory) -> str:
    topic = DOCUMENT_TOPICS[index % len(DOCUMENT_TOPICS)]
    return f"{topic} — {category.value}"


def build_document_description(user: Users, category: AchievementCategory, level: AchievementLevel, result: AchievementResult) -> str:
    return (
        f"Подтверждение достижения по направлению «{category.value}». "
        f"Уровень: {level.value}, результат: {result.value}. "
        f"Студент {user.first_name} {user.last_name}, курс {user.course}, группа {user.study_group}."
    )


def build_support_text(subject: str, prefix: str) -> str:
    return f"{prefix}: {subject.lower()}. Нужна помощь с проверкой и отображением данных в системе."


async def ensure_staff_users(db, password_hash: str, now: datetime) -> tuple[Users, Users]:
    specs = [
        {
            "email": SUPER_ADMIN_EMAIL,
            "first_name": "Супер",
            "last_name": "Админ",
            "role": UserRole.SUPER_ADMIN,
            "education_level": None,
            "moderator_courses": None,
            "moderator_groups": None,
        },
        {
            "email": MODERATOR_EMAIL,
            "first_name": "Демо",
            "last_name": "Модератор",
            "role": UserRole.MODERATOR,
            "education_level": EducationLevel.SPECIALIST,
            "moderator_courses": ",".join(str(c) for c in SPECIALIST_COURSES),
            "moderator_groups": ",".join(groups_for(EducationLevel.SPECIALIST.value)),
        },
    ]

    result_users: dict[UserRole, Users] = {}

    for spec in specs:
        result = await db.execute(select(Users).where(Users.email == spec["email"]))
        user = result.scalars().first()
        if user is None:
            user = Users(email=spec["email"], created_at=now - timedelta(days=365))

        user.first_name = spec["first_name"]
        user.last_name = spec["last_name"]
        user.hashed_password = password_hash
        user.role = spec["role"]
        user.status = UserStatus.ACTIVE
        user.education_level = spec["education_level"]
        user.course = None
        user.study_group = None
        user.moderator_courses = spec["moderator_courses"]
        user.moderator_groups = spec["moderator_groups"]
        user.session_gpa = None
        user.is_active = True
        user.reviewed_by_id = None
        user.failed_attempts = 0
        user.blocked_until = None
        user.session_version = int(user.session_version or 1) + 1
        user.api_access_version = int(user.api_access_version or 1) + 1
        user.api_refresh_version = int(user.api_refresh_version or 1) + 1

        db.add(user)
        await db.flush()
        result_users[spec["role"]] = user

    return result_users[UserRole.SUPER_ADMIN], result_users[UserRole.MODERATOR]


async def seed_users(db, moderator: Users, password_hash: str, now: datetime) -> tuple[list[Users], list[Users], list[Users]]:
    active_students: list[Users] = []
    deleted_students: list[Users] = []
    pending_users: list[Users] = []

    course_groups = {c: groups_for(EducationLevel.SPECIALIST.value, c) for c in SPECIALIST_COURSES}

    global_index = 0
    for course in SPECIALIST_COURSES:
        first_group, second_group = course_groups[course]
        for position in range(ACTIVE_STUDENTS_PER_COURSE):
            first_name, last_name = build_name(global_index)
            group = first_group if position < ACTIVE_STUDENTS_PER_COURSE // 2 else second_group
            created_at = now - timedelta(days=180 - (global_index % 90), hours=global_index % 12)
            active_students.append(
                Users(
                    first_name=first_name,
                    last_name=last_name,
                    email=build_active_email(course, group, position + 1),
                    hashed_password=password_hash,
                    role=UserRole.STUDENT,
                    status=UserStatus.ACTIVE,
                    education_level=EducationLevel.SPECIALIST,
                    course=course,
                    study_group=group,
                    session_gpa=f"{4.1 + (global_index % 9) * 0.1:.1f}",
                    is_active=True,
                    created_at=created_at,
                )
            )
            global_index += 1

    for index in range(DELETED_STUDENTS_COUNT):
        course = SPECIALIST_COURSES[index % len(SPECIALIST_COURSES)]
        groups = course_groups[course]
        group = groups[index % len(groups)]
        first_name, last_name = build_name(300 + index)
        deleted_students.append(
            Users(
                first_name=first_name,
                last_name=last_name,
                email=build_deleted_email(index + 1),
                hashed_password=password_hash,
                role=UserRole.GUEST,
                status=UserStatus.DELETED,
                education_level=EducationLevel.SPECIALIST,
                course=course,
                study_group=group,
                session_gpa=None,
                is_active=True,
                created_at=now - timedelta(days=240 + index),
            )
        )

    for index in range(PENDING_APPLICATIONS_COUNT):
        course = SPECIALIST_COURSES[index % len(SPECIALIST_COURSES)]
        groups = course_groups[course]
        group = groups[index % len(groups)]
        first_name, last_name = build_name(500 + index)
        pending_users.append(
            Users(
                first_name=first_name,
                last_name=last_name,
                email=build_pending_email(index + 1),
                hashed_password=password_hash,
                role=UserRole.GUEST,
                status=UserStatus.PENDING,
                education_level=EducationLevel.SPECIALIST,
                course=course,
                study_group=group,
                session_gpa=None,
                is_active=True,
                reviewed_by_id=moderator.id if index < ASSIGNED_PENDING_APPLICATIONS else None,
                created_at=now - timedelta(days=index, hours=index % 6),
            )
        )

    db.add_all(active_students + deleted_students + pending_users)
    await db.flush()

    return active_students, deleted_students, pending_users


async def seed_achievements(db, active_students: list[Users], moderator: Users, now: datetime) -> list[Achievement]:
    achievements: list[Achievement] = []

    for index, user in enumerate(active_students):
        category = CATEGORIES[index % len(CATEGORIES)]
        level = LEVELS[index % len(LEVELS)]
        result = RESULTS[index % len(RESULTS)]

        both_asset = await upload_demo_asset("achievements", f"both_{user.id}_{index}", image=index % 4 == 0)
        achievements.append(
            Achievement(
                user_id=user.id,
                title=build_document_title(index, category),
                description=build_document_description(user, category, level, result),
                file_path=both_asset.path,
                external_url=both_asset.url,
                category=category,
                level=level,
                result=result,
                points=calculate_points(level.value, category.value, result.value),
                status=AchievementStatus.APPROVED,
                moderator_id=moderator.id,
                created_at=now - timedelta(days=90 - (index % 45), hours=index % 10),
            )
        )

        link_asset = await upload_demo_asset("achievements", f"link_{user.id}_{index}", image=index % 5 == 0)
        next_category = CATEGORIES[(index + 2) % len(CATEGORIES)]
        next_level = LEVELS[(index + 1) % len(LEVELS)]
        next_result = RESULTS[(index + 1) % len(RESULTS)]
        achievements.append(
            Achievement(
                user_id=user.id,
                title=f"{build_document_title(index + 1, next_category)} (ссылка)",
                description=build_document_description(user, next_category, next_level, next_result),
                file_path=None,
                external_url=link_asset.url,
                category=next_category,
                level=next_level,
                result=next_result,
                points=calculate_points(next_level.value, next_category.value, next_result.value),
                status=AchievementStatus.APPROVED,
                moderator_id=moderator.id,
                created_at=now - timedelta(days=60 - (index % 30), hours=(index + 2) % 12),
            )
        )

    for index in range(INCOMING_PENDING_DOCUMENTS):
        user = active_students[index]
        category = CATEGORIES[(index + 3) % len(CATEGORIES)]
        level = LEVELS[(index + 2) % len(LEVELS)]
        result = RESULTS[(index + 2) % len(RESULTS)]
        asset = await upload_demo_asset("achievements", f"incoming_pending_{user.id}_{index}", image=index % 3 == 0)
        achievements.append(
            Achievement(
                user_id=user.id,
                title=f"{build_document_title(100 + index, category)} (входящее)",
                description=build_document_description(user, category, level, result),
                file_path=asset.path,
                external_url=asset.url if index % 2 == 0 else None,
                category=category,
                level=level,
                result=result,
                points=0,
                status=AchievementStatus.PENDING,
                moderator_id=None,
                created_at=now - timedelta(days=index % 7, hours=index % 8),
            )
        )

    for index in range(ASSIGNED_PENDING_DOCUMENTS):
        user = active_students[INCOMING_PENDING_DOCUMENTS + index]
        category = CATEGORIES[(index + 5) % len(CATEGORIES)]
        level = LEVELS[(index + 4) % len(LEVELS)]
        result = RESULTS[index % len(RESULTS)]
        asset = await upload_demo_asset("achievements", f"assigned_pending_{user.id}_{index}", image=index % 4 == 1)
        achievements.append(
            Achievement(
                user_id=user.id,
                title=f"{build_document_title(200 + index, category)} (в работе)",
                description=build_document_description(user, category, level, result),
                file_path=asset.path,
                external_url=asset.url if index % 3 == 0 else None,
                category=category,
                level=level,
                result=result,
                points=0,
                status=AchievementStatus.PENDING,
                moderator_id=moderator.id,
                created_at=now - timedelta(days=index % 10, hours=(index + 1) % 6),
            )
        )

    for index in range(12):
        user = active_students[40 + index]
        category = CATEGORIES[(index + 1) % len(CATEGORIES)]
        level = LEVELS[(index + 3) % len(LEVELS)]
        result = RESULTS[(index + 2) % len(RESULTS)]
        asset = await upload_demo_asset("achievements", f"revision_{user.id}_{index}", image=index % 2 == 0)
        achievements.append(
            Achievement(
                user_id=user.id,
                title=f"{build_document_title(300 + index, category)} (доработка)",
                description=build_document_description(user, category, level, result),
                file_path=asset.path,
                external_url=asset.url,
                category=category,
                level=level,
                result=result,
                points=0,
                status=AchievementStatus.REVISION,
                rejection_reason="Нужно уточнить описание и прикрепить более читаемое подтверждение.",
                moderator_id=moderator.id,
                created_at=now - timedelta(days=15 + index, hours=index % 4),
            )
        )

    for index in range(8):
        user = active_students[60 + index]
        category = CATEGORIES[(index + 2) % len(CATEGORIES)]
        level = LEVELS[(index + 1) % len(LEVELS)]
        result = RESULTS[index % len(RESULTS)]
        asset = await upload_demo_asset("achievements", f"rejected_{user.id}_{index}", image=index % 2 == 1)
        achievements.append(
            Achievement(
                user_id=user.id,
                title=f"{build_document_title(400 + index, category)} (отклонено)",
                description=build_document_description(user, category, level, result),
                file_path=asset.path,
                external_url=None,
                category=category,
                level=level,
                result=result,
                points=0,
                status=AchievementStatus.REJECTED,
                rejection_reason="Документ не подтверждает заявленный результат.",
                moderator_id=moderator.id,
                created_at=now - timedelta(days=25 + index, hours=index % 5),
            )
        )

    db.add_all(achievements)
    await db.flush()
    return achievements


async def seed_support(db, active_students: list[Users], moderator: Users, now: datetime) -> tuple[list[SupportTicket], list[SupportMessage]]:
    tickets: list[SupportTicket] = []
    messages: list[SupportMessage] = []

    for index in range(OPEN_SUPPORT_TICKETS):
        owner = active_students[index]
        created_at = now - timedelta(days=index % 6, hours=index % 12)
        ticket = SupportTicket(
            user_id=owner.id,
            moderator_id=None,
            subject=SUPPORT_SUBJECTS[index % len(SUPPORT_SUBJECTS)],
            status=SupportTicketStatus.OPEN,
            created_at=created_at,
            updated_at=created_at,
            assigned_at=None,
            session_expires_at=None,
            closed_at=None,
        )
        tickets.append(ticket)

    for index in range(IN_PROGRESS_SUPPORT_TICKETS):
        owner = active_students[OPEN_SUPPORT_TICKETS + index]
        created_at = now - timedelta(days=index % 8, hours=(index + 2) % 10)
        assigned_at = created_at + timedelta(minutes=40)
        ticket = SupportTicket(
            user_id=owner.id,
            moderator_id=moderator.id,
            subject=f"{SUPPORT_SUBJECTS[index % len(SUPPORT_SUBJECTS)]} (в работе)",
            status=SupportTicketStatus.IN_PROGRESS,
            created_at=created_at,
            updated_at=assigned_at,
            assigned_at=assigned_at,
            session_expires_at=assigned_at + timedelta(days=30),
            closed_at=None,
        )
        tickets.append(ticket)

    for index in range(CLOSED_SUPPORT_TICKETS):
        owner = active_students[70 + index]
        created_at = now - timedelta(days=20 + index, hours=index % 6)
        assigned_at = created_at + timedelta(hours=2)
        closed_at = assigned_at + timedelta(hours=5)
        ticket = SupportTicket(
            user_id=owner.id,
            moderator_id=moderator.id,
            subject=f"{SUPPORT_SUBJECTS[index % len(SUPPORT_SUBJECTS)]} (закрыто)",
            status=SupportTicketStatus.CLOSED,
            created_at=created_at,
            updated_at=closed_at,
            assigned_at=assigned_at,
            session_expires_at=None,
            closed_at=closed_at,
        )
        tickets.append(ticket)

    db.add_all(tickets)
    await db.flush()

    for index, ticket in enumerate(tickets[:OPEN_SUPPORT_TICKETS]):
        owner = next(user for user in active_students if user.id == ticket.user_id)
        attachment = None
        if index % 5 == 0:
            attachment = await upload_demo_asset("support", f"open_ticket_{ticket.id}", image=True)
        msg = SupportMessage(
            ticket_id=ticket.id,
            sender_id=owner.id,
            text=build_support_text(ticket.subject, "Здравствуйте"),
            file_path=attachment.path if attachment else None,
            is_from_moderator=False,
            created_at=ticket.created_at,
        )
        messages.append(msg)
        ticket.updated_at = msg.created_at

    offset = OPEN_SUPPORT_TICKETS
    for index, ticket in enumerate(tickets[offset:offset + IN_PROGRESS_SUPPORT_TICKETS]):
        owner = next(user for user in active_students if user.id == ticket.user_id)
        attachment = None
        if index % 4 == 0:
            attachment = await upload_demo_asset("support", f"progress_ticket_{ticket.id}", image=index % 8 == 0)

        first_at = ticket.created_at
        second_at = (ticket.assigned_at or first_at) + timedelta(minutes=25)
        third_at = second_at + timedelta(hours=2)

        messages.extend([
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=owner.id,
                text=build_support_text(ticket.subject, "Добрый день"),
                file_path=attachment.path if attachment else None,
                is_from_moderator=False,
                created_at=first_at,
            ),
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=moderator.id,
                text="Обращение принято в работу. Проверяю историю документа и вернусь с уточнением.",
                file_path=None,
                is_from_moderator=True,
                created_at=second_at,
            ),
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=owner.id,
                text="Спасибо, отправил дополнительные пояснения и жду ответ.",
                file_path=None,
                is_from_moderator=False,
                created_at=third_at,
            ),
        ])
        ticket.updated_at = third_at

    offset += IN_PROGRESS_SUPPORT_TICKETS
    for index, ticket in enumerate(tickets[offset:]):
        owner = next(user for user in active_students if user.id == ticket.user_id)
        first_at = ticket.created_at
        second_at = (ticket.assigned_at or first_at) + timedelta(minutes=45)
        third_at = second_at + timedelta(hours=1)
        fourth_at = ticket.closed_at or third_at
        messages.extend([
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=owner.id,
                text=build_support_text(ticket.subject, "Здравствуйте"),
                file_path=None,
                is_from_moderator=False,
                created_at=first_at,
            ),
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=moderator.id,
                text="Вижу проблему. Уточняю данные по заявке и баллам.",
                file_path=None,
                is_from_moderator=True,
                created_at=second_at,
            ),
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=owner.id,
                text="Подтверждаю, этого решения достаточно. Спасибо.",
                file_path=None,
                is_from_moderator=False,
                created_at=third_at,
            ),
            SupportMessage(
                ticket_id=ticket.id,
                sender_id=moderator.id,
                text="Проблема решена, обращение закрыто. Изменения уже отражены в системе.",
                file_path=None,
                is_from_moderator=True,
                created_at=fourth_at,
            ),
        ])
        ticket.updated_at = fourth_at

    db.add_all(messages)
    await db.flush()
    return tickets, messages


async def main() -> None:
    await ensure_demo_schema()
    await cleanup_demo_objects()

    password_hash = hash_password(COMMON_PASSWORD)
    now = datetime.now(timezone.utc)

    async with async_session_maker() as db:
        super_admin, moderator = await ensure_staff_users(db, password_hash, now)
        staff_ids = [super_admin.id, moderator.id]

        await db.execute(delete(UserToken))
        await db.execute(delete(Notification))
        await db.execute(delete(SeasonResult))
        await db.execute(delete(SupportMessage))
        await db.execute(delete(SupportTicket))
        await db.execute(delete(Achievement))
        await db.execute(delete(AuditLog))
        await db.execute(delete(UserNote))
        await db.execute(delete(Users).where(~Users.id.in_(staff_ids)))
        await db.flush()

        active_students, deleted_students, pending_users = await seed_users(db, moderator, password_hash, now)
        achievements = await seed_achievements(db, active_students, moderator, now)
        tickets, _messages = await seed_support(db, active_students, moderator, now)

        await db.commit()

    incoming_docs = sum(1 for item in achievements if item.status == AchievementStatus.PENDING and item.moderator_id is None)
    assigned_docs = sum(1 for item in achievements if item.status == AchievementStatus.PENDING and item.moderator_id is not None)
    approved_docs = sum(1 for item in achievements if item.status == AchievementStatus.APPROVED)

    print("Demo dataset reset complete.")
    print(f"Active students: {len(active_students)}")
    print(f"Deleted accounts: {len(deleted_students)}")
    print(f"Pending applications: {len(pending_users)}")
    print(f"Assigned pending applications: {ASSIGNED_PENDING_APPLICATIONS}")
    print(f"Approved achievements: {approved_docs}")
    print(f"Incoming pending achievements: {incoming_docs}")
    print(f"Assigned pending achievements: {assigned_docs}")
    print(f"Open support tickets: {OPEN_SUPPORT_TICKETS}")
    print(f"In-progress support tickets: {IN_PROGRESS_SUPPORT_TICKETS}")
    print(f"Closed support tickets: {CLOSED_SUPPORT_TICKETS}")
    print(f"Super admin: {SUPER_ADMIN_EMAIL} / {COMMON_PASSWORD}")
    print(f"Moderator: {MODERATOR_EMAIL} / {COMMON_PASSWORD}")
    print(f"All demo users password: {COMMON_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
