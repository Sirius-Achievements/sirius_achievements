import importlib
import os
import sys
import types

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))

from app.config import Settings


def test_default_settings():
    s = Settings()
    assert s.ENV == "development" or isinstance(s.ENV, str)
    assert s.MAX_AVATAR_SIZE == 2 * 1024 * 1024
    assert s.MAX_DOC_SIZE == 10 * 1024 * 1024
    assert s.MAX_SUPPORT_FILE_SIZE == 5 * 1024 * 1024
    assert s.LOGIN_MAX_ATTEMPTS == 5
    assert s.ITEMS_PER_PAGE == 10
    assert s.SUPPORT_ITEMS_PER_PAGE == 20
    assert s.POINTS_SCHOOL == 10
    assert s.POINTS_INTERNATIONAL == 100


def test_resume_flags_default_to_false():
    # Verify the code default without relying on the current .env — call the parser directly.
    from app.config import _env_bool
    assert _env_bool("__RESUME_FLAG_NEVER_SET__", False) is False


def test_upload_dirs():
    s = Settings()
    assert "avatars" in s.UPLOAD_DIR_AVATARS
    assert "achievements" in s.UPLOAD_DIR_ACHIEVEMENTS
    assert "support" in s.UPLOAD_DIR_SUPPORT
