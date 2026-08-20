from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.orm.attributes import NO_VALUE


def _enum_value(value):
    if value is None:
        return None
    return value.value if hasattr(value, 'value') else value


def _iso(value: datetime | None):
    return value.isoformat() if value else None


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


def _loaded_relationship(instance: Any, attr_name: str, default: Any = None):
    if instance is None:
        return default

    state = inspect(instance, raiseerr=False)
    if state is None or not hasattr(state, 'attrs'):
        return default

    try:
        value = state.attrs[attr_name].loaded_value
    except Exception:
        return default

    if value is NO_VALUE:
        return default

    return value


def serialize_user(user):
    return {
        'id': user.id,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'email': user.email,
        'phone_number': user.phone_number,
        'avatar_path': user.avatar_path,
        'public_visibility': getattr(user, 'public_visibility', None) or {},
        'registration_rejection_reason': getattr(user, 'registration_rejection_reason', None),
        'role': _enum_value(user.role),
        'status': _enum_value(user.status),
        'education_level': _enum_value(user.education_level),
        'course': user.course,
        'study_group': user.study_group,
        'moderator_courses': [
            int(item) for item in _split_csv(getattr(user, 'moderator_courses', None)) if item.isdigit()
        ],
        'moderator_groups': _split_csv(getattr(user, 'moderator_groups', None)),
        'session_gpa': user.session_gpa,
        'is_active': bool(user.is_active),
        'created_at': _iso(user.created_at),
        'updated_at': _iso(user.updated_at),
        'resume_text': getattr(user, 'resume_text', None),
        'resume_generated_at': _iso(getattr(user, 'resume_generated_at', None)),
        'reviewed_by_id': getattr(user, 'reviewed_by_id', None),
    }


def serialize_user_brief(user):
    if not user:
        return None

    return {
        'id': user.id,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'email': user.email,
        'education_level': _enum_value(getattr(user, 'education_level', None)),
        'avatar_path': getattr(user, 'avatar_path', None),
    }


def serialize_achievement(achievement):
    user = _loaded_relationship(achievement, 'user')
    return {
        'id': achievement.id,
        'user_id': achievement.user_id,
        'title': achievement.title,
        'description': achievement.description,
        'file_path': achievement.file_path,
        'external_url': getattr(achievement, 'external_url', None),
        'category': _enum_value(achievement.category),
        'level': _enum_value(achievement.level),
        'result': _enum_value(getattr(achievement, 'result', None)),
        'points': int(achievement.points or 0),
        'status': _enum_value(achievement.status),
        'rejection_reason': achievement.rejection_reason,
        'moderator_id': achievement.moderator_id,
        'created_at': _iso(achievement.created_at),
        'updated_at': _iso(achievement.updated_at),
        'user': serialize_user_brief(user),
        'projected_points': int(getattr(achievement, 'projected_points', 0) or 0),
    }


def serialize_support_message(message):
    from app.utils.support_crypto import decrypt_text
    sender = _loaded_relationship(message, 'sender')
    return {
        'id': message.id,
        'ticket_id': message.ticket_id,
        'sender_id': message.sender_id,
        'reply_to_id': getattr(message, 'reply_to_id', None),
        'text': decrypt_text(message.text),
        'file_path': message.file_path,
        'is_from_moderator': bool(message.is_from_moderator),
        'created_at': _iso(message.created_at),
        'sender': serialize_user_brief(sender),
    }


def serialize_support_ticket(ticket, *, include_messages: bool = False):
    messages = _loaded_relationship(ticket, 'messages', [])
    user = _loaded_relationship(ticket, 'user')
    moderator = _loaded_relationship(ticket, 'moderator')
    payload = {
        'id': ticket.id,
        'user_id': ticket.user_id,
        'moderator_id': ticket.moderator_id,
        'subject': ticket.subject,
        'category': getattr(ticket, 'category', 'technical'),
        'resolution': getattr(ticket, 'resolution', None),
        'status': _enum_value(ticket.status),
        'student_unread_count': int(getattr(ticket, 'student_unread_count', 0) or 0),
        'moderator_unread_count': int(getattr(ticket, 'moderator_unread_count', 0) or 0),
        'created_at': _iso(ticket.created_at),
        'updated_at': _iso(ticket.updated_at),
        'assigned_at': _iso(getattr(ticket, 'assigned_at', None)),
        'session_expires_at': _iso(getattr(ticket, 'session_expires_at', None)),
        'closed_at': _iso(getattr(ticket, 'closed_at', None)),
        'archived_at': _iso(getattr(ticket, 'archived_at', None)),
        'messages_count': len(messages or []),
        'user': serialize_user_brief(user),
        'moderator': serialize_user_brief(moderator),
    }
    if include_messages:
        payload['messages'] = [serialize_support_message(item) for item in messages or []]
    return payload


def serialize_user_public(user):
    """Public profile serializer — no email, phone, resume, or internal fields."""
    return {
        'id': user.id,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'avatar_path': user.avatar_path,
        'education_level': _enum_value(user.education_level),
        'course': user.course,
        'study_group': user.study_group,
        'session_gpa': getattr(user, 'session_gpa', None),
    }


def serialize_user_note(note):
    author = _loaded_relationship(note, 'author')
    return {
        'id': note.id,
        'user_id': note.user_id,
        'author_id': note.author_id,
        'text': note.text,
        'file_path': note.file_path,
        'has_file': bool(note.file_path),
        'created_at': _iso(note.created_at),
        'author': serialize_user_brief(author),
    }


def serialize_notification(notification):
    return {
        'id': notification.id,
        'title': notification.title,
        'message': notification.message,
        'is_read': bool(notification.is_read),
        'link': notification.link,
        'created_at': _iso(notification.created_at),
    }
