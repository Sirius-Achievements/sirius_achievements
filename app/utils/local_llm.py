import logging

import httpx

from app.config import settings

log = logging.getLogger("local_llm")


async def call_local_llm(
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 1000,
    temperature: float = 0.1,
) -> str | None:
    """Вызывает локальную LLM через vLLM (OpenAI-совместимый /chat/completions).
    Возвращает текст ответа или None при ошибке/недоступности сервиса."""
    payload = {
        "model": settings.LOCAL_LLM_MODEL,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    url = f"{settings.LOCAL_LLM_BASE_URL.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if settings.LOCAL_LLM_API_KEY:
        headers["Authorization"] = f"Bearer {settings.LOCAL_LLM_API_KEY}"

    async with httpx.AsyncClient(timeout=max(45.0, float(settings.LOCAL_LLM_TIMEOUT))) as client:
        try:
            response = await client.post(url, headers=headers, json=payload, timeout=settings.LOCAL_LLM_TIMEOUT)
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            log.error("Local LLM API HTTP %s: %s", e.response.status_code, e.response.text[:200])
            return None
        except Exception as e:
            log.error("Local LLM API error: %s", e)
            return None
