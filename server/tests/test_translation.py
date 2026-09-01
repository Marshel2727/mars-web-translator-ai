from unittest.mock import AsyncMock, patch
import pytest
from app.services.cache_service import TranslationCacheService
from app.services.translator_service import TranslatorService
from app.schemas.translate import OllamaOptionsPayload, TranslateItem


@pytest.mark.asyncio
async def test_cache_service_crud():
    cache = TranslationCacheService()
    
    # Verify initial stats
    stats = await cache.get_stats()
    assert stats["total_entries"] == 0
    
    # Set entry
    await cache.set("Hello", "translate", "Halo")
    
    # Get entry
    val = await cache.get("Hello", "translate")
    assert val == "Halo"
    
    # Case and whitespace are semantic and must not collide.
    assert await cache.get("hello", "translate") is None
    assert await cache.get("  Hello  ", "translate") is None

    # Only line endings are normalized.
    await cache.set("Line 1\r\nLine 2", "translate", "Baris")
    assert await cache.get("Line 1\nLine 2", "translate") == "Baris"
    
    # Miss check
    val_miss = await cache.get("Goodbye", "translate")
    assert val_miss is None
    
    # Update stats
    stats = await cache.get_stats()
    assert stats["total_entries"] == 2
    assert stats["schema_version"] == 2
    
    # Clear cache
    await cache.clear()
    stats = await cache.get_stats()
    assert stats["total_entries"] == 0


@pytest.mark.asyncio
async def test_translator_service_cache_hit(mock_ollama_client):
    service = TranslatorService()
    cache = TranslationCacheService()
    await cache.set(
        "Open the door",
        "translate",
        "Buka pintu",
        service.translation_profile(),
    )
    
    result = await service.translate("Open the door", "translate")
    
    assert result == "Buka pintu"
    mock_ollama_client.generate.assert_not_called()


@pytest.mark.asyncio
async def test_translator_service_cache_miss(mock_ollama_client):
    mock_ollama_client.generate.return_value = "Buka jendela"
    
    service = TranslatorService()
    result = await service.translate("Open the window", "translate")
    
    assert result == "Buka jendela"
    mock_ollama_client.generate.assert_called_once()
    
    # Verify it was saved to cache with correct model
    cache = TranslationCacheService()
    cached = await cache.get(
        "Open the window", "translate", service.translation_profile()
    )
    assert cached == "Buka jendela"


@pytest.mark.asyncio
async def test_translator_service_skip_indonesian(mock_ollama_client):
    service = TranslatorService()
    indonesian_text = "Saya sedang belajar bahasa Indonesia dengan bantuan komputer ini."
    result = await service.translate(indonesian_text, "translate")
    
    assert result == indonesian_text
    mock_ollama_client.generate.assert_not_called()


@pytest.mark.asyncio
async def test_translator_service_sanitize_rules(mock_ollama_client):
    mock_ollama_client.generate.return_value = "<text_to_translate>Halo Dunia</text_to_translate> Aturan: Jangan ubah kode."
    
    service = TranslatorService()
    result = await service.translate("Hello World 1", "translate")
    assert result == "Hello World 1"  # _sanitize returns None for leak → translate returns original
    
    mock_ollama_client.generate.return_value = "<text_to_translate>Halo Dunia</text_to_translate>"
    result = await service.translate("Hello World 2", "translate")
    assert result == "Halo Dunia"


@pytest.mark.asyncio
async def test_batch_translate_success(mock_ollama_client):
    # Mock numbered list batch return (new format)
    mock_ollama_client.generate.return_value = "[1] Satu\n[2] Dua"
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}
    
    # Verify both stored in cache with correct model
    cache = TranslationCacheService()
    profile = service.translation_profile()
    assert await cache.get("One", "translate", profile) == "Satu"
    assert await cache.get("Two", "translate", profile) == "Dua"


@pytest.mark.asyncio
async def test_batch_translate_fallback_on_invalid_output(mock_ollama_client):
    """When model output has no numbered list, falls back to individual translation."""
    mock_ollama_client.generate.side_effect = [
        "some random text without numbered format",  # Batch call
        "Satu",                                      # Individual fallback 1
        "Dua",                                       # Individual fallback 2
    ]
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}


@pytest.mark.asyncio
async def test_batch_translate_fallback_on_missing_item(mock_ollama_client):
    """When model returns fewer items than expected, missing ones fall back individually."""
    mock_ollama_client.generate.side_effect = [
        "[1] Satu",  # Batch call returns only 1 of 2 items
        "Dua",        # Individual fallback for item 2
    ]
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}


@pytest.mark.asyncio
async def test_batch_does_not_retry_unchanged_result(mock_ollama_client):
    mock_ollama_client.generate.return_value = "[1] API"

    service = TranslatorService()
    results = await service.translate_batch(
        [TranslateItem(id="api", text="API")],
        "translate",
    )

    assert results == {"api": "API"}
    assert mock_ollama_client.generate.await_count == 1


def test_batch_parser_preserves_multiline_output():
    service = TranslatorService()
    parsed = service._parse_batch_result(
        "[1] Baris pertama\nBaris kedua\n\n[2] Hasil lain",
        expected_count=2,
    )

    assert parsed == {
        0: "Baris pertama\nBaris kedua",
        1: "Hasil lain",
    }


@pytest.mark.asyncio
async def test_translator_service_applies_glossary(mock_ollama_client):
    mock_ollama_client.generate.return_value = "Pengakuan perangkat keras"

    service = TranslatorService()
    result = await service.translate("Hardware support feature", "translate")

    assert result == "Dukungan perangkat keras"


def test_api_health_endpoint(test_client):
    active = "mars-translator-qwen3:latest"
    with (
        patch(
            "app.api.v1.endpoints.health.list_installed_models",
            new=AsyncMock(return_value=[active]),
        ),
        patch("app.api.v1.endpoints.health.OllamaClient") as client_class,
    ):
        client_class.return_value.is_model_on_gpu = AsyncMock(return_value=True)
        response = test_client.get("/api/v1/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["active_model"]["gpu"] is True
    assert len(data["translation_profile"]) == 64


def test_api_cache_endpoints(test_client):
    response = test_client.delete("/api/v1/cache/clear")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    
    response = test_client.get("/api/v1/cache/stats")
    assert response.status_code == 200
    assert response.json()["total_entries"] == 0


def test_api_batch_translate_endpoint(test_client, mock_ollama_client):
    mock_ollama_client.generate.return_value = "[1] Terjemahan Sukses"
    
    payload = {
        "mode": "translate",
        "items": [
            {"id": "abc", "text": "Successful translation"}
        ]
    }
    response = test_client.post("/api/v1/translate/batch", json=payload)
    assert response.status_code == 200
    
    res_data = response.json()
    assert len(res_data["results"]) == 1
    assert res_data["results"][0]["id"] == "abc"
    assert res_data["results"][0]["translated_text"] == "Terjemahan Sukses"
    assert len(res_data["translation_profile"]) == 64


# ================================================================
# Tests for OllamaOptionsPayload
# ================================================================

def test_ollama_options_payload_defaults():
    opts = OllamaOptionsPayload()
    assert opts.num_ctx is None
    assert opts.num_predict is None
    assert opts.temperature is None
    assert opts.top_p is None
    assert opts.keep_alive is None


def test_ollama_options_payload_subtitle_preset():
    opts = OllamaOptionsPayload(
        num_ctx=512,
        num_predict=64,
        temperature=0.0,
        top_p=0.8,
        keep_alive="30m",
    )
    assert opts.num_ctx == 512
    assert opts.num_predict == 64
    assert opts.keep_alive == "30m"


@pytest.mark.asyncio
async def test_translator_service_passes_options_to_ollama(mock_ollama_client):
    mock_ollama_client.generate.return_value = "Terjemahan opsi"

    opts = OllamaOptionsPayload(num_ctx=512, num_predict=64, temperature=0.0, top_p=0.8, keep_alive="15m")
    service = TranslatorService()
    result = await service.translate("Options forward test", "translate", options=opts)

    assert result == "Terjemahan opsi"
    call_kwargs = mock_ollama_client.generate.call_args
    assert call_kwargs is not None
    passed_options = call_kwargs.kwargs.get("options") or {}
    assert passed_options.get("num_ctx") == 512
    assert passed_options.get("num_predict") == 64
    assert call_kwargs.kwargs.get("keep_alive") == "15m"


def test_api_batch_translate_with_ollama_options(test_client, mock_ollama_client):
    mock_ollama_client.generate.return_value = "[1] Terjemahan dengan opsi"

    payload = {
        "mode": "translate",
        "items": [{"id": "x1", "text": "Options test in API"}],
        "options": {
            "num_ctx": 512,
            "num_predict": 64,
            "temperature": 0.0,
            "top_p": 0.8,
            "keep_alive": "30m",
        },
    }
    response = test_client.post("/api/v1/translate/batch", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["results"][0]["translated_text"] == "Terjemahan dengan opsi"
