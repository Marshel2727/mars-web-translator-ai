import asyncio
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_RETRY_DELAYS = (1.0, 2.0)
_RETRYABLE_STATUS_CODES = {429, 502, 503, 504}


class OllamaError(RuntimeError):
    """Base exception for predictable Ollama failures."""


class OllamaUnavailableError(OllamaError):
    pass


class OllamaTimeoutError(OllamaError):
    pass


class OllamaHTTPError(OllamaError):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        super().__init__(detail)


class OllamaModelError(OllamaHTTPError):
    pass


class OllamaGPUError(OllamaError):
    pass


class OllamaClient:
    _client: httpx.AsyncClient | None = None

    def __init__(self, model: str | None = None):
        self.base_url = settings.OLLAMA_BASE_URL.rstrip("/")
        self.model = model or settings.OLLAMA_MODEL

    @classmethod
    def client(cls) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=settings.OLLAMA_CONNECT_TIMEOUT,
                    read=settings.REQUEST_TIMEOUT,
                    write=settings.REQUEST_TIMEOUT,
                    pool=settings.OLLAMA_CONNECT_TIMEOUT,
                ),
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

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = f"{self.base_url}{path}"
        last_error: Exception | None = None

        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self.client().request(method, url, **kwargs)
                if response.status_code >= 400:
                    detail = response.text.strip() or f"HTTP {response.status_code}"
                    if response.status_code not in _RETRYABLE_STATUS_CODES:
                        if response.status_code == 404:
                            raise OllamaModelError(response.status_code, detail)
                        raise OllamaHTTPError(response.status_code, detail)
                    last_error = OllamaHTTPError(response.status_code, detail)
                else:
                    return response
            except httpx.ReadTimeout as exc:
                raise OllamaTimeoutError(
                    f"Ollama tidak merespons dalam {settings.REQUEST_TIMEOUT} detik."
                ) from exc
            except httpx.ConnectTimeout as exc:
                last_error = exc
            except httpx.ConnectError as exc:
                last_error = exc
            except httpx.TimeoutException as exc:
                raise OllamaTimeoutError("Operasi Ollama melewati batas waktu.") from exc

            if attempt < _MAX_ATTEMPTS - 1:
                delay = _RETRY_DELAYS[attempt]
                logger.warning(
                    "Ollama request failed (attempt %d/%d); retrying in %.1fs: %s",
                    attempt + 1,
                    _MAX_ATTEMPTS,
                    delay,
                    last_error,
                )
                await asyncio.sleep(delay)

        if isinstance(last_error, OllamaError):
            raise last_error
        raise OllamaUnavailableError(
            f"Tidak dapat terhubung ke Ollama di {self.base_url}."
        ) from last_error

    async def list_models(self) -> list[str]:
        response = await self._request("GET", "/api/tags")
        data = response.json()
        return [item["name"] for item in data.get("models", []) if item.get("name")]

    async def running_models(self) -> list[dict[str, Any]]:
        response = await self._request("GET", "/api/ps")
        return response.json().get("models", [])

    async def is_model_on_gpu(self, model: str) -> bool:
        for item in await self.running_models():
            if item.get("name") == model or item.get("model") == model:
                return int(item.get("size_vram") or 0) > 0
        return False

    async def load_model(self, model: str) -> None:
        await self._request(
            "POST",
            "/api/generate",
            json={
                "model": model,
                "prompt": "",
                "stream": False,
                "keep_alive": "30m",
                "options": {"num_predict": 1},
            },
        )

    async def unload_model(self, model: str) -> None:
        await self._request(
            "POST",
            "/api/generate",
            json={"model": model, "prompt": "", "stream": False, "keep_alive": 0},
        )

    async def generate(
        self,
        prompt: str,
        response_format: str | None = None,
        model: str | None = None,
        options: dict | None = None,
        keep_alive: str | None = None,
    ) -> str:
        target_model = model or self.model
        base_options: dict[str, Any] = {
            "temperature": 0.1,
            "top_p": 0.9,
            "num_ctx": settings.DEFAULT_NUM_CTX,
            "num_predict": settings.DEFAULT_NUM_PREDICT,
        }
        if options:
            for key in {"num_ctx", "num_predict", "temperature", "top_p"}:
                if options.get(key) is not None:
                    base_options[key] = options[key]

        payload: dict[str, Any] = {
            "model": target_model,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "keep_alive": keep_alive if keep_alive is not None else "30m",
            "options": base_options,
        }
        if response_format:
            payload["format"] = response_format

        response = await self._request("POST", "/api/generate", json=payload)
        return response.json().get("response", "").strip()
