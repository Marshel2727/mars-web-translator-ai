from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from conftest import TEST_API_TOKEN

client = TestClient(app)


def authenticate(websocket):
    websocket.send_json({"action": "auth", "token": TEST_API_TOKEN})
    response = websocket.receive_json()
    assert response["event"] == "authenticated"


def test_websocket_health():
    payload = {
        "status": "ok",
        "ollama": {"status": "ok"},
        "active_model": {
            "name": "mars-translator-qwen3:latest",
            "installed": True,
            "gpu": True,
        },
        "translation_profile": "profile",
    }
    with patch(
        "app.api.v1.endpoints.ws.get_health_payload",
        new=AsyncMock(return_value=(payload, True)),
    ):
        with client.websocket_connect("/api/v1/ws/health") as websocket:
            authenticate(websocket)
            websocket.send_json({"action": "ping", "timestamp": 123456789})
            data = websocket.receive_json()
        assert data["event"] == "pong"
        assert data["status"] == "ok"
        assert "active_model" in data
        assert "translation_profile" in data


def test_websocket_cache_stats():
    with client.websocket_connect("/api/v1/ws/cache") as websocket:
        authenticate(websocket)
        websocket.send_json({"action": "get_stats"})
        data = websocket.receive_json()
        assert data["event"] == "cache_stats"
        assert data["data"]["schema_version"] == 2


def test_websocket_translate_validates_and_forwards_options(mock_ollama_client):
    mock_ollama_client.generate.return_value = "[1] Halo\nBaris kedua"

    with client.websocket_connect("/api/v1/ws/translate") as websocket:
        authenticate(websocket)
        websocket.send_json(
            {
                "action": "translate",
                "items": [{"id": "ws-1", "text": "Hello from websocket"}],
                "options": {
                    "num_ctx": 512,
                    "num_predict": 64,
                    "keep_alive": "15m",
                },
            }
        )
        data = websocket.receive_json()

    assert data["event"] == "translated_item"
    assert data["id"] == "ws-1"
    assert data["translated_text"] == "Halo\nBaris kedua"
    assert len(data["translation_profile"]) == 64
    call_kwargs = mock_ollama_client.generate.call_args.kwargs
    assert call_kwargs["options"]["num_ctx"] == 512
    assert call_kwargs["keep_alive"] == "15m"


def test_websocket_translate_rejects_duplicate_ids():
    with client.websocket_connect("/api/v1/ws/translate") as websocket:
        authenticate(websocket)
        websocket.send_json(
            {
                "action": "translate",
                "items": [
                    {"id": "same", "text": "First item"},
                    {"id": "same", "text": "Second item"},
                ],
            }
        )
        data = websocket.receive_json()

    assert data["event"] == "error"
    assert data["code"] == "VALIDATION_ERROR"
    assert "Duplicate item IDs" in data["detail"]


def test_websocket_translate_rejects_empty_batch():
    with client.websocket_connect("/api/v1/ws/translate") as websocket:
        authenticate(websocket)
        websocket.send_json({"action": "translate", "items": []})
        data = websocket.receive_json()

    assert data["event"] == "error"
    assert data["code"] == "VALIDATION_ERROR"


def test_websocket_rejects_invalid_token_with_4401():
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect("/api/v1/ws/health") as websocket:
            websocket.send_json({"action": "auth", "token": "invalid"})
            assert websocket.receive_json()["code"] == "AUTH_INVALID"
            websocket.receive_json()
    assert caught.value.code == 4401


def test_websocket_rejects_forbidden_origin_with_4403():
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(
            "/api/v1/ws/health", headers={"Origin": "https://evil.example"}
        ) as websocket:
            assert websocket.receive_json()["code"] == "ORIGIN_FORBIDDEN"
            websocket.receive_json()
    assert caught.value.code == 4403
