from fastapi import APIRouter

from app.routers.api.v1.achievements import router as achievements_router
from app.routers.api.v1.auth import router as auth_router
from app.routers.api.v1.dashboard import router as dashboard_router
from app.routers.api.v1.documents import router as documents_router
from app.routers.api.v1.leaderboard import router as leaderboard_router
from app.routers.api.v1.media import router as media_router
from app.routers.api.v1.moderation import router as moderation_router
from app.routers.api.v1.moderation_support import router as moderation_support_router
from app.routers.api.v1.my_work import router as my_work_router
from app.routers.api.v1.notifications import router as notifications_router
from app.routers.api.v1.points import router as points_router
from app.routers.api.v1.profile import router as profile_router
from app.routers.api.v1.public import router as public_router
from app.routers.api.v1.reports import router as reports_router
from app.routers.api.v1.support import router as support_router
from app.routers.api.v1.users import router as users_router
from app.routers.api.v1.user_notes import router as user_notes_router
from app.routers.api.v1.bug_reports import router as bug_reports_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(dashboard_router)
router.include_router(profile_router)
router.include_router(notifications_router)
router.include_router(points_router)
router.include_router(reports_router)
router.include_router(achievements_router)
router.include_router(leaderboard_router)
router.include_router(media_router)
router.include_router(users_router)
router.include_router(user_notes_router)
router.include_router(bug_reports_router)
router.include_router(documents_router)
router.include_router(support_router)
router.include_router(moderation_router)
router.include_router(moderation_support_router)
router.include_router(my_work_router)
router.include_router(public_router)
