from sqlalchemy import case, select
from sqlalchemy.orm import selectinload
from app.repositories.admin.base_crud_repository import BaseCrudRepository
from app.models.achievement import Achievement
from app.models.enums import AchievementLevel, AchievementResult, AchievementStatus
from app.models.user import Users
from app.utils.search import escape_like


class AchievementRepository(BaseCrudRepository):
    def __init__(self, db):
        super().__init__(db, Achievement)

    def build_filter_stmt(
            self,
            search: str = "",
            status: str = "",
            category: str = "",
            level: str = "",
            result: str = "",
            sort_by: str = "newest",
            owner_education_level=None,
            owner_courses=None,
            owner_groups=None,
            owner_id: int | None = None,
            statuses=None,
            categories=None,
            levels=None,
            results=None,
    ):
        stmt = select(self.model).options(selectinload(self.model.user))
        if owner_education_level is not None or owner_courses or owner_groups or owner_id is not None:
            stmt = stmt.join(Users, self.model.user_id == Users.id)
            if owner_education_level is not None:
                stmt = stmt.filter(Users.education_level == owner_education_level)
            if owner_courses:
                courses = [int(item) for item in str(owner_courses).split(',') if item.isdigit()]
                if courses:
                    stmt = stmt.filter(Users.course.in_(courses))
            if owner_groups:
                groups = [item.strip() for item in str(owner_groups).split(',') if item.strip()]
                if groups:
                    stmt = stmt.filter(Users.study_group.in_(groups))
            if owner_id is not None:
                stmt = stmt.filter(Users.id == owner_id)

        if search:
            like_term = f"%{escape_like(search)}%"
            stmt = stmt.filter(
                (self.model.title.ilike(like_term)) |
                (self.model.description.ilike(like_term))
            )

        # Multi-select filters use IN (OR within a dimension); different dimensions
        # are separate filters and therefore combine with AND.
        if statuses:
            stmt = stmt.filter(self.model.status.in_(statuses))
        elif status and status != "all":
            stmt = stmt.filter(self.model.status == status)
        else:
            stmt = stmt.filter(self.model.status != AchievementStatus.ARCHIVED)

        if categories:
            stmt = stmt.filter(self.model.category.in_(categories))
        elif category and category != "all":
            stmt = stmt.filter(self.model.category == category)

        if levels:
            stmt = stmt.filter(self.model.level.in_(levels))
        elif level and level != "all":
            stmt = stmt.filter(self.model.level == level)

        if results:
            stmt = stmt.filter(self.model.result.in_(results))
        elif result and result != "all":
            stmt = stmt.filter(self.model.result == result)

        if sort_by == "oldest":
            stmt = stmt.order_by(self.model.created_at.asc())
        elif sort_by == "level":
            level_order = case(
                (self.model.level == AchievementLevel.INTERNATIONAL, 5),
                (self.model.level == AchievementLevel.FEDERAL, 4),
                (self.model.level == AchievementLevel.REGIONAL, 3),
                (self.model.level == AchievementLevel.MUNICIPAL, 2),
                (self.model.level == AchievementLevel.SCHOOL, 1),
                else_=0,
            )
            stmt = stmt.order_by(level_order.desc(), self.model.created_at.desc())
        elif sort_by == "result":
            result_order = case(
                (self.model.result == AchievementResult.WINNER, 3),
                (self.model.result == AchievementResult.PRIZEWINNER, 2),
                (self.model.result == AchievementResult.PARTICIPANT, 1),
                else_=0,
            )
            stmt = stmt.order_by(result_order.desc(), self.model.created_at.desc())
        elif sort_by == "category":
            stmt = stmt.order_by(self.model.category.asc(), self.model.created_at.desc())
        elif sort_by == "title":
            stmt = stmt.order_by(self.model.title.asc(), self.model.created_at.desc())
        else:
            stmt = stmt.order_by(self.model.created_at.desc())

        return stmt

    async def get_all_with_filters(
            self,
            search: str = "",
            status: str = "",
            category: str = "",
            level: str = "",
            result: str = "",
            sort_by: str = "newest",
            owner_education_level=None,
            owner_courses=None,
            owner_groups=None,
            owner_id: int | None = None,
    ):
        stmt = self.build_filter_stmt(
            search=search,
            status=status,
            category=category,
            level=level,
            result=result,
            sort_by=sort_by,
            owner_education_level=owner_education_level,
            owner_courses=owner_courses,
            owner_groups=owner_groups,
            owner_id=owner_id,
        )
        result = await self.db.execute(stmt)
        return result.scalars().all()
