from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.infrastructure.database import Base

class SeasonResult(Base):
    __tablename__ = "season_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("seasons.id", ondelete="CASCADE"), nullable=True, index=True)
    season_name = Column(String(100), nullable=False)
    points = Column(Integer, default=0)
    rank = Column(Integer, default=0)
    achievements_count = Column(Integer, default=0, server_default="0")
    category_points = Column(JSON, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("Users")
    season = relationship("Season", back_populates="results")
