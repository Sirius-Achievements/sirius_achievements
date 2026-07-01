import sys
import pytest
from unittest.mock import AsyncMock, MagicMock

# If a sibling test replaced app.utils.rate_limiter with a stub, drop it so we get the real module.
_stub = sys.modules.get("app.utils.rate_limiter")
if _stub is not None and not hasattr(_stub, "RateLimiter"):
    del sys.modules["app.utils.rate_limiter"]

from app.utils.rate_limiter import RateLimiter  # noqa: E402


@pytest.fixture
def mock_redis():
    redis = MagicMock()
    redis.get = AsyncMock(return_value=None)
    redis.delete = AsyncMock()
    # RateLimiter registers a Lua script at construction and invokes it for atomic increment.
    incr_script = AsyncMock(return_value=1)
    redis.register_script = MagicMock(return_value=incr_script)
    return redis


@pytest.fixture
def limiter(mock_redis):
    return RateLimiter(redis=mock_redis)


@pytest.mark.asyncio
async def test_not_limited_initially(limiter):
    assert await limiter.is_limited("key", 5, 900) is False


@pytest.mark.asyncio
async def test_limited_when_exceeded(limiter, mock_redis):
    mock_redis.get.return_value = "5"
    assert await limiter.is_limited("key", 5, 900) is True


@pytest.mark.asyncio
async def test_not_limited_below_threshold(limiter, mock_redis):
    mock_redis.get.return_value = "3"
    assert await limiter.is_limited("key", 5, 900) is False


@pytest.mark.asyncio
async def test_increment_calls_lua_script(limiter, mock_redis):
    result = await limiter.increment("key", 900)
    assert result == 1
    limiter._incr_script.assert_awaited_once_with(keys=["key"], args=[900])


@pytest.mark.asyncio
async def test_check_and_increment_blocks_over_limit(limiter):
    limiter._incr_script = AsyncMock(return_value=6)
    assert await limiter.check_and_increment("key", 5, 900) is True


@pytest.mark.asyncio
async def test_check_and_increment_allows_below_limit(limiter):
    limiter._incr_script = AsyncMock(return_value=3)
    assert await limiter.check_and_increment("key", 5, 900) is False


@pytest.mark.asyncio
async def test_reset(limiter, mock_redis):
    await limiter.reset("key")
    mock_redis.delete.assert_called_once_with("key")


@pytest.mark.asyncio
async def test_remaining(limiter, mock_redis):
    mock_redis.get.return_value = "3"
    assert await limiter.remaining("key", 5) == 2


@pytest.mark.asyncio
async def test_remaining_no_attempts(limiter, mock_redis):
    mock_redis.get.return_value = None
    assert await limiter.remaining("key", 5) == 5
