import json
from unittest.mock import AsyncMock
import pytest
from app.services.cache_service import TranslationCacheService
from app.services.translator_service import TranslatorService
from app.schemas.translate import TranslateItem

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
    
    # Case insensitivity & whitespace normalization check
    val_norm = await cache.get("  hello  ", "translate")
    assert val_norm == "Halo"
    
    # Miss check
    val_miss = await cache.get("Goodbye", "translate")
    assert val_miss is None
    
    # Update stats
    stats = await cache.get_stats()
    assert stats["total_entries"] == 1
    
    # Clear cache
    await cache.clear()
    stats = await cache.get_stats()
    assert stats["total_entries"] == 0

@pytest.mark.asyncio
async def test_translator_service_cache_hit(mock_ollama_client):
    cache = TranslationCacheService()
    await cache.set("Open the door", "translate", "Buka pintu")
    
    service = TranslatorService()
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
    
    # Verify it was saved to cache
    cache = TranslationCacheService()
    cached = await cache.get("Open the window", "translate")
    assert cached == "Buka jendela"

@pytest.mark.asyncio
async def test_translator_service_skip_indonesian(mock_ollama_client):
    service = TranslatorService()
    # Teks bahasa Indonesia yang jelas
    indonesian_text = "Saya sedang belajar bahasa Indonesia dengan bantuan komputer ini."
    result = await service.translate(indonesian_text, "translate")
    
    assert result == indonesian_text
    mock_ollama_client.generate.assert_not_called()

@pytest.mark.asyncio
async def test_translator_service_sanitize_rules(mock_ollama_client):
    # Mock return value containing leak patterns/tags
    mock_ollama_client.generate.return_value = "<text_to_translate>Halo Dunia</text_to_translate> Aturan: Jangan ubah kode."
    
    service = TranslatorService()
    result = await service.translate("Hello World 1", "translate")
    assert result == "Hello World 1"  # Should fall back due to prompt leak marker
    
    # Let's test the tags removal with a clean translation
    mock_ollama_client.generate.return_value = "<text_to_translate>Halo Dunia</text_to_translate>"
    result = await service.translate("Hello World 2", "translate")
    assert result == "Halo Dunia"

@pytest.mark.asyncio
async def test_batch_translate_success(mock_ollama_client):
    # Mock successful JSON batch return
    mock_ollama_client.generate.return_value = json.dumps({
        "results": [
            {"id": "1", "translated_text": "Satu"},
            {"id": "2", "translated_text": "Dua"}
        ]
    })
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}
    
    # Verify both stored in cache
    cache = TranslationCacheService()
    assert await cache.get("One", "translate") == "Satu"
    assert await cache.get("Two", "translate") == "Dua"

@pytest.mark.asyncio
async def test_batch_translate_fallback_on_invalid_json(mock_ollama_client):
    # Ollama returns malformed JSON
    mock_ollama_client.generate.side_effect = [
        "invalid json response here",  # Batch call
        "Satu",                        # Individual fallback 1
        "Dua"                          # Individual fallback 2
    ]
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}

@pytest.mark.asyncio
async def test_batch_translate_fallback_on_missing_id(mock_ollama_client):
    # Ollama returns JSON with only one item translated
    mock_ollama_client.generate.side_effect = [
        json.dumps({"results": [{"id": "1", "translated_text": "Satu"}]}),  # Batch call
        "Dua"                                                               # Individual fallback for item 2
    ]
    
    service = TranslatorService()
    items = [
        TranslateItem(id="1", text="One"),
        TranslateItem(id="2", text="Two")
    ]
    results = await service.translate_batch(items, "translate")
    
    assert results == {"1": "Satu", "2": "Dua"}

def test_api_health_endpoint(test_client):
    response = test_client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "message": "Mars Web Translator AI server is running"
    }

def test_api_cache_endpoints(test_client):
    # Clear cache first
    response = test_client.delete("/api/v1/cache/clear")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    
    # Get stats
    response = test_client.get("/api/v1/cache/stats")
    assert response.status_code == 200
    assert response.json()["total_entries"] == 0

def test_api_batch_translate_endpoint(test_client, mock_ollama_client):
    mock_ollama_client.generate.return_value = json.dumps({
        "results": [
            {"id": "abc", "translated_text": "Terjemahan Sukses"}
        ]
    })
    
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
