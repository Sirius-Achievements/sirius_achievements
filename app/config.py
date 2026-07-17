import os
from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool = False) -> bool:
    return str(os.getenv(name, str(default))).strip().lower() in {"true", "1", "yes", "on"}


class Settings:
    # ── Environment ──
    ENV: str = os.getenv("ENV", "development")
    DEBUG: bool = _env_bool("DEBUG", False)

    # ── Database ──
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "5432")
    DB_NAME: str = os.getenv("DB_NAME", "sirius")
    DB_USERNAME: str = os.getenv("DB_USERNAME", "postgres")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")

    # ── Redis ──
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

    # ── Session ──
    SESSION_MAX_AGE: int = int(os.getenv("SESSION_MAX_AGE", "86400"))

    # ── File upload limits (bytes) ──
    MAX_AVATAR_SIZE: int = int(os.getenv("MAX_AVATAR_SIZE", str(2 * 1024 * 1024)))
    MAX_DOC_SIZE: int = int(os.getenv("MAX_DOC_SIZE", str(10 * 1024 * 1024)))
    MAX_SUPPORT_FILE_SIZE: int = int(os.getenv("MAX_SUPPORT_FILE_SIZE", str(5 * 1024 * 1024)))

    # ── Upload directories ──
    UPLOAD_DIR_AVATARS: str = "static/uploads/avatars"
    UPLOAD_DIR_ACHIEVEMENTS: str = "static/uploads/achievements"
    UPLOAD_DIR_SUPPORT: str = "static/uploads/support"

    # ── Rate limiting ──
    LOGIN_MAX_ATTEMPTS: int = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
    LOGIN_LOCKOUT_TTL: int = int(os.getenv("LOGIN_LOCKOUT_TTL", "900"))

    API_LOGIN_MAX_ATTEMPTS: int = int(os.getenv("API_LOGIN_MAX_ATTEMPTS", "10"))
    API_LOGIN_LOCKOUT_TTL: int = int(os.getenv("API_LOGIN_LOCKOUT_TTL", "900"))

    API_REFRESH_MAX_ATTEMPTS: int = int(os.getenv("API_REFRESH_MAX_ATTEMPTS", "20"))
    API_REFRESH_LOCKOUT_TTL: int = int(os.getenv("API_REFRESH_LOCKOUT_TTL", "900"))

    FORGOT_PWD_MAX_ATTEMPTS: int = int(os.getenv("FORGOT_PWD_MAX_ATTEMPTS", "5"))
    FORGOT_PWD_LOCKOUT_TTL: int = int(os.getenv("FORGOT_PWD_LOCKOUT_TTL", "900"))

    OTP_MAX_ATTEMPTS: int = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    OTP_LOCKOUT_TTL: int = int(os.getenv("OTP_LOCKOUT_TTL", "900"))

    UPLOAD_MAX_PER_HOUR: int = int(os.getenv("UPLOAD_MAX_PER_HOUR", "20"))
    UPLOAD_RATE_TTL: int = int(os.getenv("UPLOAD_RATE_TTL", "3600"))

    # ── Pagination ──
    ITEMS_PER_PAGE: int = int(os.getenv("ITEMS_PER_PAGE", "10"))
    SUPPORT_ITEMS_PER_PAGE: int = int(os.getenv("SUPPORT_ITEMS_PER_PAGE", "20"))
    SUPPORT_SESSION_DEFAULT_DAYS: int = int(os.getenv("SUPPORT_SESSION_DEFAULT_DAYS", "30"))
    SUPPORT_SESSION_DAY_DAYS: int = int(os.getenv("SUPPORT_SESSION_DAY_DAYS", "1"))
    SUPPORT_SESSION_WEEK_DAYS: int = int(os.getenv("SUPPORT_SESSION_WEEK_DAYS", "7"))
    SUPPORT_SESSION_MONTH_DAYS: int = int(os.getenv("SUPPORT_SESSION_MONTH_DAYS", "30"))
    SUPPORT_ARCHIVE_AFTER_DAYS: int = int(os.getenv("SUPPORT_ARCHIVE_AFTER_DAYS", "90"))

    # ── Points per achievement level ──
    POINTS_SCHOOL: int = int(os.getenv("POINTS_SCHOOL", "10"))
    POINTS_MUNICIPAL: int = int(os.getenv("POINTS_MUNICIPAL", "20"))
    POINTS_REGIONAL: int = int(os.getenv("POINTS_REGIONAL", "40"))
    POINTS_FEDERAL: int = int(os.getenv("POINTS_FEDERAL", "75"))
    POINTS_INTERNATIONAL: int = int(os.getenv("POINTS_INTERNATIONAL", "100"))

    # ── Result multipliers (×100 to avoid floats) ──
    RESULT_MULTIPLIER_PARTICIPANT: int = int(os.getenv("RESULT_MULTIPLIER_PARTICIPANT", "50"))
    RESULT_MULTIPLIER_PRIZEWINNER: int = int(os.getenv("RESULT_MULTIPLIER_PRIZEWINNER", "75"))
    RESULT_MULTIPLIER_WINNER: int = int(os.getenv("RESULT_MULTIPLIER_WINNER", "100"))

    # ── Mail ──
    MAIL_HOST: str = os.getenv("MAIL_HOST", "smtp.yandex.ru")
    MAIL_PORT: int = int(os.getenv("MAIL_PORT", "465"))
    MAIL_USERNAME: str = os.getenv("MAIL_USERNAME", "")
    MAIL_PASSWORD: str = os.getenv("MAIL_PASSWORD", "")
    MAIL_FROM: str = os.getenv("MAIL_FROM", os.getenv("MAIL_USERNAME", ""))
    MAIL_TIMEOUT: int = int(os.getenv("MAIL_TIMEOUT", "30"))
    MAIL_USE_SSL: bool = _env_bool("MAIL_USE_SSL", os.getenv("MAIL_PORT", "465") == "465")
    MAIL_USE_STARTTLS: bool = _env_bool(
        "MAIL_USE_STARTTLS", os.getenv("MAIL_PORT", "465") not in {"465"}
    )
    MAIL_DEV_LOG_CODES: bool = _env_bool("MAIL_DEV_LOG_CODES", False)

    # ── Локальная LLM (Qwen2.5-7B-Instruct-AWQ через vLLM) ──
    LOCAL_LLM_BASE_URL: str = os.getenv("LOCAL_LLM_BASE_URL", "http://vllm:8000/v1")
    LOCAL_LLM_MODEL: str = os.getenv("LOCAL_LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")
    LOCAL_LLM_API_KEY: str = os.getenv("LOCAL_LLM_API_KEY", "")
    LOCAL_LLM_TIMEOUT: int = int(os.getenv("LOCAL_LLM_TIMEOUT", "60"))
    RESUME_LOCAL_AI_ENABLED: bool = _env_bool("RESUME_LOCAL_AI_ENABLED", False)
    RESUME_OCR_MODEL_DOWNLOAD_ENABLED: bool = _env_bool("RESUME_OCR_MODEL_DOWNLOAD_ENABLED", False)


settings = Settings()
