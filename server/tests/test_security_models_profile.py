import json
import sqlite3
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.clients.ollama_client import (
    OllamaClient,
    OllamaHTTPError,
    OllamaTimeoutError,
    OllamaUnavailableError,
)
from app.core.errors import MarsAPIError
from app.main import app
from app.schemas.translate import OllamaOptionsPayload
from app.services.cache_service import TranslationCacheService
from app.services.model_service import activate_model, ensure_active_model_on_gpu, get_active_model
from app.services.profile_service import get_translation_profile
from conftest import TEST_API_TOKEN


def test_rest_requires_token_and_accepts_cli_without_origin():
    client = TestClient(app)
    missing = client.get("/api/v1/cache/stats")
    invalid = client.get("/api/v1/cache/stats", headers={"X-Mars-Token": "wrong"})
    valid = client.get(
        "/api/v1/cache/stats", headers={"X-Mars-Token": TEST_API_TOKEN}
    )

    assert missing.status_code == 401
    assert missing.json()["code"] == "AUTH_INVALID"
    assert invalid.status_code == 401
    assert valid.status_code == 200


def test_rest_rejects_web_origin_and_accepts_extension_origin():
    client = TestClient(app)
    token = {"X-Mars-Token": TEST_API_TOKEN}
    forbidden = client.get(
        "/api/v1/cache/stats",
        headers={**token, "Origin": "https://evil.example"},
    )
    allowed = client.get(
        "/api/v1/cache/stats",
        headers={**token, "Origin": f"chrome-extension://{'a' * 32}"},
    )

    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "ORIGIN_FORBIDDEN"
    assert allowed.status_code == 200


def test_extension_cors_preflight_allows_token_header():
    client = TestClient(app)
    origin = f"chrome-extension://{'b' * 32}"
    response = client.options(
        "/api/v1/translate/batch",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-mars-token",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "translate", "items": [{"id": "x" * 129, "text": "Hello"}]},
        {"mode": "translate", "items": [{"id": "x", "text": "a" * 4001}]},
        {
            "mode": "translate",
            "items": [{"id": str(index), "text": "a" * 4000} for index in range(11)],
        },
        {
            "mode": "translate",
            "items": [{"id": "x", "text": "Hello"}],
            "model": "invalid model!",
        },
        {
            "mode": "translate",
            "items": [{"id": "x", "text": "Hello"}],
            "options": {"keep_alive": "forever"},
        },
    ],
)
def test_translate_validation_returns_structured_422(test_client, payload):
    response = test_client.post("/api/v1/translate/batch", json=payload)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_translate_rejects_non_active_model(test_client):
    response = test_client.post(
        "/api/v1/translate/batch",
        json={
            "mode": "translate",
            "model": "another-model:latest",
            "items": [{"id": "x", "text": "Hello"}],
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == "MODEL_NOT_ACTIVE"


def test_models_list_does_not_insert_stale_active_model(test_client):
    with patch(
        "app.api.v1.endpoints.models.list_installed_models",
        new=AsyncMock(return_value=["installed:latest"]),
    ):
        response = test_client.get("/api/v1/models/")
    assert response.status_code == 200
    assert response.json()["models"] == ["installed:latest"]
    assert response.json()["active_model"] not in response.json()["models"]


@pytest.mark.asyncio
async def test_model_activation_verifies_gpu_then_persists(tmp_path, monkeypatch):
    active_file = tmp_path / "active_model.json"
    active_file.write_text('{"model":"old:latest"}', encoding="utf-8")
    monkeypatch.setattr("app.services.model_service._ACTIVE_MODEL_FILE", active_file)
    client = AsyncMock(spec=OllamaClient)
    client.list_models.return_value = ["new"]
    client.is_model_on_gpu.return_value = True

    result = await activate_model("new", client)

    assert result == "new:latest"
    client.load_model.assert_awaited_once_with("new:latest")
    client.is_model_on_gpu.assert_awaited_once_with("new:latest")
    client.unload_model.assert_awaited_once_with("old:latest")
    assert json.loads(active_file.read_text(encoding="utf-8"))["model"] == "new:latest"


@pytest.mark.asyncio
async def test_model_activation_does_not_persist_cpu_model(tmp_path, monkeypatch):
    active_file = tmp_path / "active_model.json"
    active_file.write_text('{"model":"old:latest"}', encoding="utf-8")
    monkeypatch.setattr("app.services.model_service._ACTIVE_MODEL_FILE", active_file)
    client = AsyncMock(spec=OllamaClient)
    client.list_models.return_value = ["cpu-model:latest"]
    client.is_model_on_gpu.return_value = False

    with pytest.raises(MarsAPIError) as caught:
        await activate_model("cpu-model", client)

    assert caught.value.code == "GPU_REQUIRED"
    assert get_active_model() == "old:latest"
    client.unload_model.assert_awaited_once_with("cpu-model:latest")


@pytest.mark.asyncio
async def test_backend_runtime_gate_rejects_cpu_model(tmp_path, monkeypatch):
    active_file = tmp_path / "active_model.json"
    active_file.write_text('{"model":"cpu-model:latest"}', encoding="utf-8")
    monkeypatch.setattr("app.services.model_service._ACTIVE_MODEL_FILE", active_file)
    client = AsyncMock(spec=OllamaClient)
    client.list_models.return_value = ["cpu-model:latest"]
    client.is_model_on_gpu.return_value = False

    with pytest.raises(Exception, match="size_vram=0"):
        await ensure_active_model_on_gpu(client)

    client.load_model.assert_awaited_once_with("cpu-model:latest")
    client.unload_model.assert_awaited_once_with("cpu-model:latest")


def test_active_model_is_read_fresh_from_disk(tmp_path, monkeypatch):
    active_file = tmp_path / "active_model.json"
    monkeypatch.setattr("app.services.model_service._ACTIVE_MODEL_FILE", active_file)
    active_file.write_text('{"model":"first"}', encoding="utf-8")
    assert get_active_model() == "first:latest"
    active_file.write_text('{"model":"second:tag"}', encoding="utf-8")
    assert get_active_model() == "second:tag"


def test_translation_profile_tracks_generation_inputs_not_keep_alive(monkeypatch):
    base = OllamaOptionsPayload(num_ctx=512, num_predict=64, keep_alive="5m")
    same_output = OllamaOptionsPayload(num_ctx=512, num_predict=64, keep_alive="1h")
    changed = OllamaOptionsPayload(num_ctx=1024, num_predict=64, keep_alive="5m")

    assert get_translation_profile("model:latest", base) == get_translation_profile(
        "model:latest", same_output
    )
    assert get_translation_profile("model:latest", base) != get_translation_profile(
        "model:latest", changed
    )

    original = get_translation_profile("model:latest", base)
    monkeypatch.setattr("app.services.profile_service.PROMPT_VERSION", "changed")
    assert get_translation_profile("model:latest", base) != original


@pytest.mark.asyncio
async def test_cache_separates_translation_profiles():
    cache = TranslationCacheService()
    await cache.set("US", "translate", "Amerika Serikat", "profile-a")
    assert await cache.get("US", "translate", "profile-a") == "Amerika Serikat"
    assert await cache.get("US", "translate", "profile-b") is None
    assert await cache.get("us", "translate", "profile-a") is None


@pytest.mark.asyncio
async def test_cache_v1_is_deleted_during_migration(tmp_path, monkeypatch):
    await TranslationCacheService.close()
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.execute(
        "CREATE TABLE translation_cache (id INTEGER PRIMARY KEY, text_hash TEXT, mode TEXT, model TEXT, original_text TEXT, translated_text TEXT)"
    )
    connection.execute(
        "INSERT INTO translation_cache VALUES (1, 'hash', 'translate', 'old', 'Hello', 'Halo')"
    )
    connection.execute("PRAGMA user_version=1")
    connection.commit()
    connection.close()
    monkeypatch.setattr("app.services.cache_service._DB_PATH", db_path)

    await TranslationCacheService.initialize()
    stats = await TranslationCacheService().get_stats()
    cursor = await TranslationCacheService._conn().execute("PRAGMA user_version")
    version = (await cursor.fetchone())[0]
    await TranslationCacheService.close()

    assert stats["total_entries"] == 0
    assert version == 2


def test_health_reports_degraded_when_ollama_unavailable(test_client):
    with patch(
        "app.api.v1.endpoints.health.list_installed_models",
        new=AsyncMock(side_effect=OllamaUnavailableError("offline")),
    ):
        response = test_client.get("/api/v1/health/")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["ollama"]["status"] == "unavailable"


class _FakeHttpClient:
    def __init__(self, side_effect):
        if isinstance(side_effect, (list, tuple, Exception)):
            self.request = AsyncMock(side_effect=side_effect)
        else:
            self.request = AsyncMock(return_value=side_effect)


def _response(status_code: int, payload=None) -> httpx.Response:
    return httpx.Response(
        status_code,
        request=httpx.Request("GET", "http://ollama.test/api"),
        json=payload or {},
    )


@pytest.mark.asyncio
async def test_ollama_retries_connect_errors_only_until_success(monkeypatch):
    request = httpx.Request("GET", "http://ollama.test/api")
    fake = _FakeHttpClient(
        [
            httpx.ConnectError("offline", request=request),
            httpx.ConnectError("offline", request=request),
            _response(200, {"models": []}),
        ]
    )
    sleep = AsyncMock()
    client = OllamaClient()
    monkeypatch.setattr(client, "client", lambda: fake)
    monkeypatch.setattr("app.clients.ollama_client.asyncio.sleep", sleep)

    assert await client.list_models() == []
    assert fake.request.await_count == 3
    assert sleep.await_count == 2


@pytest.mark.asyncio
async def test_ollama_does_not_retry_read_timeout(monkeypatch):
    request = httpx.Request("GET", "http://ollama.test/api")
    fake = _FakeHttpClient(httpx.ReadTimeout("slow", request=request))
    sleep = AsyncMock()
    client = OllamaClient()
    monkeypatch.setattr(client, "client", lambda: fake)
    monkeypatch.setattr("app.clients.ollama_client.asyncio.sleep", sleep)

    with pytest.raises(OllamaTimeoutError):
        await client.list_models()
    assert fake.request.await_count == 1
    sleep.assert_not_awaited()


@pytest.mark.asyncio
async def test_ollama_does_not_retry_http_500(monkeypatch):
    fake = _FakeHttpClient(_response(500))
    sleep = AsyncMock()
    client = OllamaClient()
    monkeypatch.setattr(client, "client", lambda: fake)
    monkeypatch.setattr("app.clients.ollama_client.asyncio.sleep", sleep)

    with pytest.raises(OllamaHTTPError):
        await client.list_models()
    assert fake.request.await_count == 1
    sleep.assert_not_awaited()


@pytest.mark.asyncio
async def test_ollama_retry_has_no_sleep_after_final_attempt(monkeypatch):
    fake = _FakeHttpClient([_response(503), _response(503), _response(503)])
    sleep = AsyncMock()
    client = OllamaClient()
    monkeypatch.setattr(client, "client", lambda: fake)
    monkeypatch.setattr("app.clients.ollama_client.asyncio.sleep", sleep)

    with pytest.raises(OllamaHTTPError):
        await client.list_models()
    assert fake.request.await_count == 3
    assert sleep.await_count == 2
