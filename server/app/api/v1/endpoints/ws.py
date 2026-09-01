"""Authenticated WebSocket endpoints with channel-isolated broadcasts."""

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.clients.ollama_client import OllamaError, OllamaTimeoutError
from app.core.errors import MarsAPIError
from app.core.security import websocket_origin_allowed, websocket_token_valid
from app.api.v1.endpoints.health import get_health_payload
from app.schemas.models import SetActiveModelRequest
from app.schemas.translate import BatchTranslateRequest
from app.services.cache_service import TranslationCacheService
from app.services.model_service import (
    activate_model,
    canonicalize_model_name,
    get_active_model,
    list_installed_models,
)
from app.services.profile_service import get_translation_profile
from app.services.translator_service import TranslatorService

router = APIRouter()
_AUTH_TIMEOUT_SECONDS = 5
_SEND_TIMEOUT_SECONDS = 5


class ConnectionManager:
    def __init__(self) -> None:
        self.channels: dict[str, set[WebSocket]] = defaultdict(set)

    def register(self, channel: str, websocket: WebSocket) -> None:
        self.channels[channel].add(websocket)

    def disconnect(self, channel: str, websocket: WebSocket) -> None:
        self.channels[channel].discard(websocket)

    async def send_json(self, websocket: WebSocket, data: dict[str, Any]) -> None:
        await asyncio.wait_for(websocket.send_json(data), timeout=_SEND_TIMEOUT_SECONDS)

    async def broadcast(self, channel: str, data: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for connection in list(self.channels[channel]):
            try:
                await self.send_json(connection, data)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(channel, connection)


manager = ConnectionManager()


def _error(code: str, detail: str) -> dict[str, str]:
    return {"event": "error", "code": code, "detail": detail}


async def _authenticate(websocket: WebSocket, channel: str) -> bool:
    await websocket.accept()
    if not websocket_origin_allowed(websocket):
        await manager.send_json(websocket, _error("ORIGIN_FORBIDDEN", "Origin tidak diizinkan."))
        await websocket.close(code=4403)
        return False

    try:
        frame = await asyncio.wait_for(
            websocket.receive_json(), timeout=_AUTH_TIMEOUT_SECONDS
        )
    except (asyncio.TimeoutError, json.JSONDecodeError, ValueError):
        await manager.send_json(websocket, _error("AUTH_REQUIRED", "Frame autentikasi wajib dikirim dalam 5 detik."))
        await websocket.close(code=4401)
        return False

    if frame.get("action") != "auth" or not websocket_token_valid(frame.get("token")):
        await manager.send_json(websocket, _error("AUTH_INVALID", "Token WebSocket tidak valid."))
        await websocket.close(code=4401)
        return False

    manager.register(channel, websocket)
    await manager.send_json(websocket, {"event": "authenticated", "channel": channel})
    return True


async def _send_exception(websocket: WebSocket, exc: Exception) -> None:
    if isinstance(exc, ValidationError):
        await manager.send_json(websocket, _error("VALIDATION_ERROR", f"Payload tidak valid: {exc}"))
    elif isinstance(exc, MarsAPIError):
        await manager.send_json(websocket, _error(exc.code, exc.detail))
    elif isinstance(exc, OllamaTimeoutError):
        await manager.send_json(websocket, _error("OLLAMA_TIMEOUT", str(exc)))
    elif isinstance(exc, OllamaError):
        await manager.send_json(websocket, _error("OLLAMA_UNAVAILABLE", str(exc)))
    else:
        await manager.send_json(websocket, _error("INTERNAL_ERROR", str(exc)))


@router.websocket("/translate")
async def websocket_translate(websocket: WebSocket):
    channel = "translate"
    if not await _authenticate(websocket, channel):
        return
    try:
        while True:
            try:
                data = await websocket.receive_json()
                if data.get("action", "translate") != "translate":
                    await manager.send_json(websocket, _error("UNKNOWN_ACTION", "Action tidak dikenal."))
                    continue

                payload = BatchTranslateRequest(
                    mode=data.get("mode", "translate"),
                    items=data.get("items", []),
                    model=data.get("model"),
                    options=data.get("options"),
                )
                active = get_active_model()
                requested = canonicalize_model_name(payload.model) if payload.model else active
                if requested != active:
                    raise MarsAPIError(404, "MODEL_NOT_ACTIVE", f"Model aktif adalah '{active}'.")

                service = TranslatorService(model=active)
                translations = await service.translate_batch(payload.items, payload.mode, payload.options)
                profile = get_translation_profile(active, payload.options)
                for item in payload.items:
                    await manager.send_json(
                        websocket,
                        {
                            "event": "translated_item",
                            "id": item.id,
                            "original_text": item.text,
                            "translated_text": translations.get(item.id, item.text),
                            "model": active,
                            "translation_profile": profile,
                        },
                    )
            except (ValidationError, MarsAPIError, OllamaError, TypeError, ValueError) as exc:
                await _send_exception(websocket, exc)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(channel, websocket)


@router.websocket("/cache")
async def websocket_cache(websocket: WebSocket):
    channel = "cache"
    if not await _authenticate(websocket, channel):
        return
    cache = TranslationCacheService()
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "get_stats")
            if action == "get_stats":
                await manager.send_json(websocket, {"event": "cache_stats", "data": await cache.get_stats()})
            elif action == "clear":
                await cache.clear()
                await manager.broadcast(channel, {"event": "cache_cleared", "status": "ok"})
            else:
                await manager.send_json(websocket, _error("UNKNOWN_ACTION", f"Action tidak dikenal: {action}"))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(channel, websocket)


@router.websocket("/models")
async def websocket_models(websocket: WebSocket):
    channel = "models"
    if not await _authenticate(websocket, channel):
        return
    try:
        while True:
            try:
                data = await websocket.receive_json()
                action = data.get("action", "list")
                if action == "list":
                    await manager.send_json(
                        websocket,
                        {
                            "event": "models_list",
                            "active_model": get_active_model(),
                            "models": await list_installed_models(),
                        },
                    )
                elif action == "set_active":
                    payload = SetActiveModelRequest(model=data.get("model"))
                    active = await activate_model(payload.model)
                    await manager.broadcast(channel, {"event": "active_model_changed", "active_model": active})
                else:
                    await manager.send_json(websocket, _error("UNKNOWN_ACTION", f"Action tidak dikenal: {action}"))
            except (ValidationError, MarsAPIError, OllamaError, TypeError, ValueError) as exc:
                await _send_exception(websocket, exc)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(channel, websocket)


@router.websocket("/health")
async def websocket_health(websocket: WebSocket):
    channel = "health"
    if not await _authenticate(websocket, channel):
        return
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("action", "ping") == "ping":
                health, _healthy = await get_health_payload()
                await manager.send_json(
                    websocket,
                    {
                        "event": "pong",
                        "status": health["status"],
                        "ollama": health["ollama"],
                        "active_model": health["active_model"],
                        "translation_profile": health["translation_profile"],
                        "timestamp": data.get("timestamp"),
                    },
                )
            else:
                await manager.send_json(websocket, _error("UNKNOWN_ACTION", "Action tidak dikenal."))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(channel, websocket)
