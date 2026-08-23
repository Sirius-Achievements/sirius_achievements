import secrets
import string
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import Users
from app.models.enums import EducationLevel, UserRole, UserStatus
from app.utils.education import groups_for
from app.utils.password import hash_password


def _generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pw = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isupper() for c in pw)
                and any(c.islower() for c in pw)
                and any(c.isdigit() for c in pw)
                and any(c in "!@#$%^&*" for c in pw)):
            return pw


class UsersTableSeeder:
    @staticmethod
    async def run(db: AsyncSession):
        result = await db.execute(select(Users).limit(1))
        if result.scalars().first():
            print("   Skipping users (already exist)")
            return

        print("   Seeding users...")

        admin_pw = _generate_password()
        moderator_pw = _generate_password()
        student_pw = _generate_password()

        admin = Users(
            email="super.admin@example.com",
            hashed_password=hash_password(admin_pw),
            first_name="Super",
            last_name="Admin",
            role=UserRole.SUPER_ADMIN.value,
            status=UserStatus.ACTIVE.value,
            is_active=True
        )
        db.add(admin)

        moderator = Users(
            email="moderator@example.com",
            hashed_password=hash_password(moderator_pw),
            first_name="Moderator",
            last_name="User",
            role=UserRole.MODERATOR.value,
            status=UserStatus.ACTIVE.value,
            is_active=True
        )
        db.add(moderator)

        student = Users(
            email="student@example.com",
            hashed_password=hash_password(student_pw),
            first_name="Student",
            last_name="User",
            role=UserRole.STUDENT.value,
            status=UserStatus.ACTIVE.value,
            education_level=EducationLevel.SPECIALIST.value,
            course=1,
            study_group=groups_for(EducationLevel.SPECIALIST.value, 1)[0],
            is_active=True
        )
        db.add(student)

        await db.commit()

        print("   Seeded credentials (change immediately!):")
        print(f"   -> super.admin@example.com")
        print(f"   -> moderator@example.com")
        print(f"   -> student@example.com")
        print("   NOTE: Passwords were written to .seed_credentials file")

        # Write credentials to a local file (NOT committed to git)
        with open(".seed_credentials", "w") as f:
            f.write(f"super.admin@example.com: {admin_pw}\n")
            f.write(f"moderator@example.com: {moderator_pw}\n")
            f.write(f"student@example.com: {student_pw}\n")
