from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.infrastructure.database import Base


class Season(Base):
    __tablename__ = "seasons"
    __table_args__ = (
        Index("ix_seasons_status", "status"),
        Index("ix_seasons_start_at", "start_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    slug = Column(String(120), nullable=False, unique=True)
    status = Column(String(32), nullable=False, default="draft", server_default="draft")
    start_at = Column(DateTime(timezone=True), nullable=False)
    submissions_open_at = Column(DateTime(timezone=True), nullable=False)
    submissions_close_at = Column(DateTime(timezone=True), nullable=True)
    moderation_close_at = Column(DateTime(timezone=True), nullable=True)
    results_published_at = Column(DateTime(timezone=True), nullable=True)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    scoring_rules_version = Column(String(50), nullable=False, default="v1", server_default="v1")
    settings = Column(JSON, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    created_by = relationship("Users", foreign_keys=[created_by_id])
    achievements = relationship("Achievement", back_populates="season")
    results = relationship("SeasonResult", back_populates="season")


class SeasonSubmissionException(Base):
    __tablename__ = "season_submission_exceptions"
    __table_args__ = (
        Index("ix_season_exceptions_lookup", "season_id", "user_id", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    season_id = Column(Integer, ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    reason = Column(Text, nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    season = relationship("Season")
    user = relationship("Users", foreign_keys=[user_id])
    created_by = relationship("Users", foreign_keys=[created_by_id])


class SeasonCategoryResult(Base):
    __tablename__ = "season_category_results"
    __table_args__ = (
        Index("ix_season_category_results_lookup", "season_id", "category", "rank"),
        Index("ix_season_category_results_user", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    season_id = Column(Integer, ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(100), nullable=False)
    points = Column(Integer, nullable=False, default=0, server_default="0")
    rank = Column(Integer, nullable=False, default=0, server_default="0")
    published_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    season = relationship("Season")
    user = relationship("Users")
