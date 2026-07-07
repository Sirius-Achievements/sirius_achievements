"""Tiny fail-open JSON cache over Redis.

Used for short-TTL caching of expensive read aggregates (leaderboard, staff
dashboard). Every operation swallows Redis errors and falls back to the DB, so
a Redis outage degrades performance but never breaks a request.
"""
from __future__ import annotations

import json
from typing import Any

from app.utils.rate_limiter import get_redis


async def cache_get_json(key: str) -> Any | None:
    try:
        raw = await get_redis().get(key)
        return json.loads(raw) if raw is not None else None
    except Exception:
        return None


async def cache_set_json(key: str, value: Any, ttl: int) -> None:
    try:
        await get_redis().set(key, json.dumps(value, ensure_ascii=False), ex=ttl)
    except Exception:
        pass


async def invalidate_prefix(*prefixes: str) -> None:
    """Delete every cached key under the given prefixes (non-blocking SCAN)."""
    try:
        redis = get_redis()
        for prefix in prefixes:
            keys = [key async for key in redis.scan_iter(match=f'{prefix}*', count=200)]
            if keys:
                await redis.delete(*keys)
    except Exception:
        pass


async def invalidate_scoreboard_caches() -> None:
    """Drop leaderboard + staff-dashboard caches after a scoring change so the
    numbers are correct immediately instead of waiting out the TTL."""
    await invalidate_prefix('lb:', 'dash:')
