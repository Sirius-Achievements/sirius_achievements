from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum, Text, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.infrastructure.database import Base
from app.models.enums import SupportTicketStatus


support_ticket_status_enum = Enum(
    SupportTicketStatus,
    name="supportticketstatus",
    values_callable=lambda enum_cls: [status.value for status in enum_cls],
)


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    moderator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    subject = Column(String(255), nullable=False)
    status = Column(support_ticket_status_enum, default=SupportTicketStatus.OPEN)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    assigned_at = Column(DateTime(timezone=True), nullable=True)
    session_expires_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("Users", back_populates="support_tickets", foreign_keys=[user_id])
    moderator = relationship("Users", back_populates="assigned_support_tickets", foreign_keys=[moderator_id])
    messages = relationship("SupportMessage", back_populates="ticket", cascade="all, delete-orphan",
                            order_by="SupportMessage.created_at.asc()")

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None
