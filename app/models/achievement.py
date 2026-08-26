from sqlalchemy import Boolean, Column, Date, Integer, String, ForeignKey, DateTime, Enum, Text, Index
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
        Index("ix_achievements_season_id", "season_id"),
        Index("ix_achievements_file_hash", "file_hash"),
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
    # Filled when a season is closed.  Unlike created_at this is an exact,
    # stable link between an archived document and the season it belongs to.
    archived_season = Column(String(100), nullable=True)
    archived_from_status = Column(String(20), nullable=True)
    season_id = Column(Integer, ForeignKey("seasons.id", ondelete="RESTRICT"), nullable=True)
    event_date = Column(Date, nullable=True)
    submitted_at = Column(DateTime(timezone=True), default=func.now(), server_default=func.now(), nullable=True)
    file_hash = Column(String(64), nullable=True)
    eligible_for_ranking = Column(Boolean, nullable=False, default=True, server_default="true")
    season_disposition = Column(String(32), nullable=False, default="eligible", server_default="eligible")

    moderator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), default=func.now(), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), default=func.now(), onupdate=func.now())

    user = relationship("Users", back_populates="achievements", foreign_keys=[user_id])
    moderator = relationship("Users", back_populates="assigned_achievements", foreign_keys=[moderator_id])
    season = relationship("Season", back_populates="achievements")
