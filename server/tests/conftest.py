import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

# Use a temporary file for the database during testing
@pytest.fixture(scope="session", autouse=True)
def temp_db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    
    # Patch the DB path in cache_service module before any imports logic runs it
    with patch("app.services.cache_service._DB_PATH", new=Path(path)):
        yield path
        
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass

@pytest_asyncio.fixture(autouse=True)
async def init_cache():
    from app.services.cache_service import TranslationCacheService
    
    # Reset/close any existing connections
    await TranslationCacheService.close()
    
    # Initialize cache database
    await TranslationCacheService.initialize()
    yield
    
    # Clear cache entries after each test to keep tests isolated
    cache = TranslationCacheService()
    try:
        await cache.clear()
    except Exception:
        pass
    await TranslationCacheService.close()

@pytest.fixture
def mock_ollama_client():
    with patch("app.services.translator_service.OllamaClient") as mock_class:
        mock_instance = mock_class.return_value
        mock_instance.generate = AsyncMock()
        yield mock_instance

@pytest.fixture
def test_client():
    from app.main import app
    return TestClient(app)
