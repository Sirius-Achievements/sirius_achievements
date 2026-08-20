from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.infrastructure.database import Base


class BugReport(Base):
    __tablename__ = 'bug_reports'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    description = Column(Text, nullable=True)
    page_url = Column(String(2048), nullable=False)
    session_id = Column(String(255), nullable=True, index=True)
    app_version = Column(String(100), nullable=True)
    user_agent = Column(String(1000), nullable=True)
    console_summary = Column(Text, nullable=True)
    network_summary = Column(Text, nullable=True)
    fingerprint = Column(String(255), nullable=True, index=True)
    status = Column(String(32), nullable=False, server_default='open', index=True)
    session_elapsed_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship('Users', lazy='selectin')
