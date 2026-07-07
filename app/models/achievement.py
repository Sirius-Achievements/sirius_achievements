from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum, Text, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.infrastructure.database import Base
from app.models.enums import AchievementStatus, AchievementCategory, AchievementLevel, AchievementResult


class Achievement(Base):
    __tablename__ = "achievements"
    __table_args__ = (
        Index("ix_achievements_user_status", "user_id", "status"),
        Index("ix_achievements_status", "status"),
        Index("ix_achievements_category", "category"),
        Index("ix_achievements_created_at", "created_at"),
        Index("ix_achievements_moderator_id", "moderator_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    file_path = Column(String, nullable=True)
    external_url = Column(String, nullable=True)

    category = Column(Enum(AchievementCategory), default=AchievementCategory.OTHER, nullable=False)
    level = Column(Enum(AchievementLevel), default=AchievementLevel.SCHOOL, nullable=False)
    result = Column(Enum(AchievementResult), nullable=True)
    points = Column(Integer, default=0)  # Баллы за достижение

    status = Column(Enum(AchievementStatus), default=AchievementStatus.PENDING)
    rejection_reason = Column(Text, nullable=True)

    moderator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), default=func.now(), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now())

    user = relationship("Users", back_populates="achievements", foreign_keys=[user_id])
    moderator = relationship("Users", back_populates="assigned_achievements", foreign_keys=[moderator_id])