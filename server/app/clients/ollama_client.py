import asyncio
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAYS = [1.0, 2.0, 4.0]
_RETRYABLE_STATUS_CODES = {429, 502, 503, 504}


class OllamaClient:
    _client: httpx.AsyncClient | None = None

    def __init__(self, model: str | None = None):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = model or settings.OLLAMA_MODEL
        self.timeout = settings.REQUEST_TIMEOUT

    @classmethod
    def client(cls) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(
                timeout=settings.REQUEST_TIMEOUT,
                limits=httpx.Limits(
                    max_connections=5,
                    max_keepalive_connections=3,
                ),
            )
        return cls._client

    @classmethod
    async def close(cls) -> None:
        if cls._client is not None:
            await cls._client.aclose()
            cls._client = None

    async def list_models(self) -> list[str]:
        url = f"{self.base_url}/api/tags"
        response = await self.client().get(url)
        response.raise_for_status()
        data = response.json()
        models = [item.get("name") for item in data.get("models", []) if item.get("name")]
        return models

    async def generate(
        self,
        prompt: str,
        response_format: str | None = None,
        model: str | None = None,
        options: dict | None = None,
        keep_alive: str | None = None,
    ) -> str:
        """Send a generation request to Ollama.

        Args:
            prompt: The prompt string to generate from.
            response_format: Optional format hint, e.g. "json".
            model: Override model for this request.
            options: Ollama options dict (num_ctx, num_predict, temperature, top_p, …).
            keep_alive: Duration to keep the model loaded in VRAM (e.g. "30m", "1h").
        """
        url = f"{self.base_url}/api/generate"
        target_model = model or self.model

        # Build base options — merge caller-supplied overrides on top of defaults.
        base_options: dict = {
            "temperature": 0.0,
            "top_p": 0.8,
            "num_ctx": settings.DEFAULT_NUM_CTX,
            "num_predict": settings.DEFAULT_NUM_PREDICT,
        }
        if options:
            # Only pass through keys that Ollama understands as "options" fields.
            _ollama_option_keys = {"num_ctx", "num_predict", "temperature", "top_p"}
            for key in _ollama_option_keys:
                if key in options and options[key] is not None:
                    base_options[key] = options[key]

        payload: dict = {
            "model": target_model,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "keep_alive": keep_alive if keep_alive is not None else "30m",
            "options": base_options,
        }

        if response_format:
            payload["format"] = response_format

        last_error: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self.client().post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                return data.get("response", "").strip()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _RETRYABLE_STATUS_CODES:
                    raise
                last_error = exc
                delay = _RETRY_DELAYS[attempt]
                logger.warning(
                    "Ollama returned %d (attempt %d/%d), retrying in %.1fs",
                    exc.response.status_code, attempt + 1, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                last_error = exc
                delay = _RETRY_DELAYS[attempt]
                logger.warning(
                    "Ollama connection error (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1, _MAX_RETRIES, delay, exc,
                )
                await asyncio.sleep(delay)

        raise last_error  # type: ignore[misc]
