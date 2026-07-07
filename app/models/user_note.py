from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.infrastructure.database import Base


class UserNote(Base):
    __tablename__ = "user_notes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    text = Column(Text, nullable=False)
    file_path = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), default=func.now(), server_default=func.now())

    user = relationship("Users", back_populates="notes", foreign_keys=[user_id])
    author = relationship("Users", foreign_keys=[author_id])
