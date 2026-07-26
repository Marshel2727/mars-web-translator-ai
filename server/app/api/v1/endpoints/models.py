import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.clients.ollama_client import OllamaClient
from app.core.config import settings
from app.schemas.models import (
    ModelListResponse,
    SetActiveModelRequest,
    SetActiveModelResponse,
)

router = APIRouter()

_ACTIVE_MODEL_FILE = Path(__file__).resolve().parent.parent.parent.parent / "data" / "active_model.json"


def _load_active_model() -> str:
    """Load the persisted active model, falling back to settings default."""
    try:
        if _ACTIVE_MODEL_FILE.exists():
            data = json.loads(_ACTIVE_MODEL_FILE.read_text(encoding="utf-8"))
            if "model" in data:
                return data["model"]
    except Exception:
        pass
    return settings.OLLAMA_MODEL


def _save_active_model(model: str) -> None:
    """Persist the active model to disk."""
    _ACTIVE_MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    _ACTIVE_MODEL_FILE.write_text(json.dumps({"model": model}), encoding="utf-8")


# Module-level cache so we don't read the file on every request
_active_model: str | None = None


def get_active_model() -> str:
    global _active_model
    if _active_model is None:
        _active_model = _load_active_model()
    return _active_model


def set_active_model(model: str) -> None:
    global _active_model
    _active_model = model
    _save_active_model(model)


@router.get("/", response_model=ModelListResponse)
async def list_models():
    try:
        client = OllamaClient()
        models = await client.list_models()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal mengambil daftar model dari Ollama: {exc}",
        )

    active = get_active_model()

    if active not in models and models:
        models.insert(0, active)

    return ModelListResponse(
        active_model=active,
        models=models,
    )


@router.post("/active", response_model=SetActiveModelResponse)
async def activate_model(payload: SetActiveModelRequest):
    try:
        client = OllamaClient()
        available_models = await client.list_models()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal memverifikasi model di Ollama: {exc}",
        )

    if available_models and payload.model not in available_models:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{payload.model}' tidak ditemukan di Ollama.",
        )

    set_active_model(payload.model)

    return SetActiveModelResponse(
        status="ok",
        active_model=payload.model,
    )
