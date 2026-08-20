from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, asc, func, or_
from sqlalchemy.orm import selectinload
from app.models.support_ticket import SupportTicket
from app.models.support_message import SupportMessage
from app.models.user import Users
from app.models.enums import SupportTicketStatus
from app.repositories.admin.crud_repository import CrudRepository
from app.utils.search import escape_like


def _apply_status_filter(stmt, filters: dict):
    """Filter tickets by one or many statuses (OR within). 'closed' also matches
    archived tickets; when 'closed' is not selected, archived tickets are hidden.
    With logic='and', keep only tickets whose OWNER has tickets in every selected state."""
    selected = list(filters.get('statuses') or [])
    single = filters.get('status')
    if single and single not in selected:
        selected.append(single)

    if not selected:
        return stmt.filter(SupportTicket.archived_at.is_(None))

    include_closed = 'closed' in selected
    others = [s for s in selected if s != 'closed']
    conditions = []
    if others:
        conditions.append(SupportTicket.status.in_(others))
    if include_closed:
        conditions.append(or_(SupportTicket.status == SupportTicketStatus.CLOSED, SupportTicket.archived_at.is_not(None)))
    else:
        stmt = stmt.filter(SupportTicket.archived_at.is_(None))
    if conditions:
        stmt = stmt.filter(or_(*conditions))

    if filters.get('status_logic') == 'and' and len(selected) > 1:
        owners = (
            select(SupportTicket.user_id)
            .filter(SupportTicket.status.in_(selected))
            .group_by(SupportTicket.user_id)
            .having(func.count(func.distinct(SupportTicket.status)) == len(selected))
        )
        stmt = stmt.filter(SupportTicket.user_id.in_(owners))
    return stmt


class SupportTicketRepository(CrudRepository):
    ITEMS_PER_PAGE = 20

    def __init__(self, db: AsyncSession):
        super().__init__(db, SupportTicket)

    async def get_by_user(self, user_id: int, view: str = "active"):
        stmt = (
            select(SupportTicket)
            .filter(SupportTicket.user_id == user_id)
            .options(selectinload(SupportTicket.messages), selectinload(SupportTicket.moderator))
            .order_by(desc(SupportTicket.updated_at))
        )
        if view == "closed":
            stmt = stmt.filter(or_(SupportTicket.status == SupportTicketStatus.CLOSED, SupportTicket.archived_at.is_not(None)))
        else:
            stmt = stmt.filter(
                SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
                SupportTicket.archived_at.is_(None),
            )
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_new_tickets(
        self,
        page: int = 1,
        education_level=None,
        courses=None,
        groups=None,
        query: str = '',
        sort_by: str = 'created_at',
        sort_order: str = 'desc',
    ):
        stmt = (
            select(SupportTicket)
            .filter(
                SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
                SupportTicket.archived_at.is_(None),
            )
            .options(
                selectinload(SupportTicket.user),
                selectinload(SupportTicket.messages),
                selectinload(SupportTicket.moderator),
            )
        )

        joined_users = False

        if query:
            like_term = f"%{escape_like(query)}%"
            stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
            joined_users = True
            stmt = stmt.filter(
                or_(
                    SupportTicket.subject.ilike(like_term),
                    Users.first_name.ilike(like_term),
                    Users.last_name.ilike(like_term),
                    Users.email.ilike(like_term),
                    (Users.first_name + ' ' + Users.last_name).ilike(like_term),
                )
            )

        if education_level is not None:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            stmt = stmt.filter(Users.education_level == education_level)
        if courses:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
            if course_values:
                stmt = stmt.filter(Users.course.in_(course_values))
        if groups:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
            if group_values:
                stmt = stmt.filter(Users.study_group.in_(group_values))

        allowed_sort = {'created_at', 'updated_at', 'assigned_at', 'subject', 'id'}
        if sort_by in allowed_sort and hasattr(SupportTicket, sort_by):
            sort_attr = getattr(SupportTicket, sort_by)
            stmt = stmt.order_by(asc(sort_attr) if sort_order == 'asc' else desc(sort_attr))
        else:
            stmt = stmt.order_by(desc(SupportTicket.created_at))

        if page > 0:
            stmt = stmt.limit(self.ITEMS_PER_PAGE).offset(self.ITEMS_PER_PAGE * (page - 1))
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def count_new_tickets(self, education_level=None, courses=None, groups=None, query: str = ''):
        stmt = select(func.count()).select_from(SupportTicket).filter(
            SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
            SupportTicket.archived_at.is_(None),
        )

        joined_users = False

        if query:
            like_term = f"%{escape_like(query)}%"
            stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
            joined_users = True
            stmt = stmt.filter(
                or_(
                    SupportTicket.subject.ilike(like_term),
                    Users.first_name.ilike(like_term),
                    Users.last_name.ilike(like_term),
                    Users.email.ilike(like_term),
                    (Users.first_name + ' ' + Users.last_name).ilike(like_term),
                )
            )

        if education_level is not None:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            stmt = stmt.filter(Users.education_level == education_level)
        if courses:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
            if course_values:
                stmt = stmt.filter(Users.course.in_(course_values))
        if groups:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
            group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
            if group_values:
                stmt = stmt.filter(Users.study_group.in_(group_values))

        result = await self.db.execute(stmt)
        return result.scalar()

    async def get_all_tickets(
        self,
        filters: dict = None,
        sort_by: str = 'created_at',
        sort_order: str = 'desc',
        education_level=None,
        courses=None,
        groups=None,
        assigned_to_id: int | None = None,
    ):
        stmt = (
            select(SupportTicket)
            .options(
                selectinload(SupportTicket.user),
                selectinload(SupportTicket.messages),
                selectinload(SupportTicket.moderator),
            )
        )
        joined_users = False

        if filters:
            stmt = _apply_status_filter(stmt, filters)
            if filters.get('query'):
                like_term = f"%{escape_like(filters['query'])}%"
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
                stmt = stmt.filter(
                    or_(
                        SupportTicket.subject.ilike(like_term),
                        Users.first_name.ilike(like_term),
                        Users.last_name.ilike(like_term),
                        Users.email.ilike(like_term),
                    )
                )
        else:
            stmt = stmt.filter(SupportTicket.archived_at.is_(None))

        if assigned_to_id is not None:
            stmt = stmt.filter(SupportTicket.moderator_id == assigned_to_id)

        if education_level is not None:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id).filter(
                    Users.education_level == education_level
                )
                joined_users = True
            else:
                stmt = stmt.filter(Users.education_level == education_level)
        if courses:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
            if course_values:
                stmt = stmt.filter(Users.course.in_(course_values))
        if groups:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
            if group_values:
                stmt = stmt.filter(Users.study_group.in_(group_values))

        _ALLOWED_SORT = {"created_at", "updated_at", "assigned_at", "status", "subject", "id"}
        if sort_by in _ALLOWED_SORT and hasattr(SupportTicket, sort_by):
            sort_attr = getattr(SupportTicket, sort_by)
            stmt = stmt.order_by(asc(sort_attr) if sort_order == 'asc' else desc(sort_attr))
        else:
            stmt = stmt.order_by(desc(SupportTicket.created_at))

        if filters and filters.get('page', 0) > 0:
            stmt = stmt.limit(self.ITEMS_PER_PAGE).offset(self.ITEMS_PER_PAGE * (filters['page'] - 1))

        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def count_all_tickets(self, filters: dict = None, education_level=None, courses=None, groups=None, assigned_to_id: int | None = None):
        stmt = select(func.count()).select_from(SupportTicket)
        joined_users = False
        if filters:
            stmt = _apply_status_filter(stmt, filters)
            if filters.get('query'):
                like_term = f"%{escape_like(filters['query'])}%"
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
                stmt = stmt.filter(
                    or_(
                        SupportTicket.subject.ilike(like_term),
                        Users.first_name.ilike(like_term),
                        Users.last_name.ilike(like_term),
                        Users.email.ilike(like_term),
                    )
                )
        else:
            stmt = stmt.filter(SupportTicket.archived_at.is_(None))

        if assigned_to_id is not None:
            stmt = stmt.filter(SupportTicket.moderator_id == assigned_to_id)

        if education_level is not None:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id).filter(
                    Users.education_level == education_level
                )
                joined_users = True
            else:
                stmt = stmt.filter(Users.education_level == education_level)
        if courses:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
                joined_users = True
            course_values = [int(item) for item in str(courses).split(',') if item.isdigit()]
            if course_values:
                stmt = stmt.filter(Users.course.in_(course_values))
        if groups:
            if not joined_users:
                stmt = stmt.join(Users, SupportTicket.user_id == Users.id)
            group_values = [item.strip() for item in str(groups).split(',') if item.strip()]
            if group_values:
                stmt = stmt.filter(Users.study_group.in_(group_values))
        result = await self.db.execute(stmt)
        return result.scalar()

    async def find_with_messages(self, ticket_id: int):
        stmt = (
            select(SupportTicket)
            .filter(SupportTicket.id == ticket_id)
            .options(
                selectinload(SupportTicket.user),
                selectinload(SupportTicket.moderator),
                selectinload(SupportTicket.messages).selectinload(SupportMessage.sender)
            )
        )
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def get_expired_active_tickets(self, cutoff):
        stmt = (
            select(SupportTicket)
            .filter(
                SupportTicket.archived_at.is_(None),
                SupportTicket.status.in_([SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS]),
                SupportTicket.session_expires_at.is_not(None),
                SupportTicket.session_expires_at <= cutoff,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_archivable_tickets(self, cutoff):
        stmt = (
            select(SupportTicket)
            .options(selectinload(SupportTicket.messages))
            .filter(
                SupportTicket.archived_at.is_(None),
                SupportTicket.status == SupportTicketStatus.CLOSED,
                SupportTicket.closed_at.is_not(None),
                SupportTicket.closed_at <= cutoff,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalars().all()


class SupportMessageRepository(CrudRepository):
    def __init__(self, db: AsyncSession):
        super().__init__(db, SupportMessage)

    async def find_with_ticket(self, message_id: int):
        stmt = (
            select(SupportMessage)
            .filter(SupportMessage.id == message_id)
            .options(
                selectinload(SupportMessage.sender),
                selectinload(SupportMessage.ticket).selectinload(SupportTicket.user),
            )
        )
        result = await self.db.execute(stmt)
        return result.scalars().first()
