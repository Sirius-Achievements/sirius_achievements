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
