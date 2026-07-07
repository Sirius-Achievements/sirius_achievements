from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum, Text, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.infrastructure.database import Base
from app.models.enums import UserRole, UserStatus, EducationLevel

class Users(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_role", "role"),
        Index("ix_users_status", "status"),
        Index("ix_users_zone", "education_level", "course", "study_group"),
        Index("ix_users_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    phone_number = Column(String, nullable=True)
    avatar_path = Column(String, nullable=True)

    role = Column(Enum(UserRole, name="user_role"), default=UserRole.GUEST)
    status = Column(Enum(UserStatus, name="userstatus"), default=UserStatus.PENDING)
    education_level = Column(Enum(EducationLevel, name="educationlevel"), nullable=True)

    course = Column(Integer, nullable=True)
    study_group = Column("study_group", String, nullable=True)
    moderator_courses = Column(String, nullable=True)
    moderator_groups = Column(String, nullable=True)
    session_gpa = Column(String, nullable=True)  # e.g. "4.5"

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    reviewed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    failed_attempts = Column(Integer, default=0)
    blocked_until = Column(DateTime, nullable=True)
    session_version = Column(Integer, nullable=False, default=1, server_default="1")
    api_access_version = Column(Integer, nullable=False, default=1, server_default="1")
    api_refresh_version = Column(Integer, nullable=False, default=1, server_default="1")

    achievements = relationship("Achievement", back_populates="user", cascade="all, delete-orphan", foreign_keys="Achievement.user_id")
    notes = relationship("UserNote", back_populates="user", cascade="all, delete-orphan", foreign_keys="UserNote.user_id")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    tokens = relationship("UserToken", back_populates="user", cascade="all, delete-orphan")
    support_tickets = relationship(
        "SupportTicket",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="SupportTicket.user_id",
    )
    assigned_support_tickets = relationship(
        "SupportTicket",
        back_populates="moderator",
        foreign_keys="SupportTicket.moderator_id",
    )
    assigned_achievements = relationship(
        "Achievement",
        back_populates="moderator",
        foreign_keys="Achievement.moderator_id",
    )
    reviewer = relationship(
        "Users",
        remote_side="Users.id",
        foreign_keys=[reviewed_by_id],
    )

    resume_text = Column(Text, nullable=True)
    resume_generated_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def education_level_value(self) -> str:
        if self.education_level is None:
            return ""
        return self.education_level.value if hasattr(self.education_level, 'value') else str(self.education_level)

    @property
    def is_staff(self) -> bool:
        return self.role in (UserRole.MODERATOR, UserRole.SUPER_ADMIN)
