import redis.asyncio as aioredis
import structlog

logger = structlog.get_logger()

_redis_client = None

# Lua script for atomic check-and-increment:
# Returns current count AFTER increment. Sets TTL only on first creation.
_INCR_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
"""


def get_redis():
    global _redis_client
    if _redis_client is None:
        from app.config import settings
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


class RateLimiter:
    """Redis-backed limiter that fails OPEN.

    If Redis is unreachable, every method degrades to "no limit in effect"
    (increment -> 0, is_limited -> False, remaining -> max) instead of raising.
    Rationale: the limiter is a protective layer, not a hard dependency of the
    request path. A Redis outage must not take down login / password reset /
    public profiles — losing brute-force protection during an outage is the
    lesser evil versus a full auth outage. Failures are logged so the outage
    stays visible and protection returns automatically once Redis recovers.
    """

    def __init__(self, redis=None):
        self.redis = redis or get_redis()
        self._incr_script = self.redis.register_script(_INCR_LUA)

    async def is_limited(self, key: str, max_attempts: int, ttl: int) -> bool:
        try:
            attempts = await self.redis.get(key)
            return attempts is not None and int(attempts) >= max_attempts
        except Exception as exc:
            logger.warning("rate_limiter_unavailable", op="is_limited", key=key, error=str(exc))
            return False

    async def increment(self, key: str, ttl: int) -> int:
        try:
            return await self._incr_script(keys=[key], args=[ttl])
        except Exception as exc:
            logger.warning("rate_limiter_unavailable", op="increment", key=key, error=str(exc))
            return 0

    async def check_and_increment(self, key: str, max_attempts: int, ttl: int) -> bool:
        """Atomically check limit and increment. Returns True if blocked."""
        try:
            count = await self._incr_script(keys=[key], args=[ttl])
            return int(count) > max_attempts
        except Exception as exc:
            logger.warning("rate_limiter_unavailable", op="check_and_increment", key=key, error=str(exc))
            return False

    async def reset(self, key: str):
        try:
            await self.redis.delete(key)
        except Exception as exc:
            logger.warning("rate_limiter_unavailable", op="reset", key=key, error=str(exc))

    async def remaining(self, key: str, max_attempts: int) -> int:
        try:
            attempts = await self.redis.get(key)
            if not attempts:
                return max_attempts
            return max(0, max_attempts - int(attempts))
        except Exception as exc:
            logger.warning("rate_limiter_unavailable", op="remaining", key=key, error=str(exc))
            return max_attempts


rate_limiter = RateLimiter()
