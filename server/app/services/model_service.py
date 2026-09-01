import json
import logging
import os
from pathlib import Path

from app.clients.ollama_client import OllamaClient, OllamaGPUError, OllamaModelError
from app.core.config import settings
from app.core.errors import MarsAPIError

logger = logging.getLogger(__name__)

_ACTIVE_MODEL_FILE = Path(__file__).resolve().parent.parent / "data" / "active_model.json"


def canonicalize_model_name(model: str) -> str:
    normalized = model.strip()
    return normalized if ":" in normalized.rsplit("/", 1)[-1] else f"{normalized}:latest"


def get_active_model() -> str:
    try:
        data = json.loads(_ACTIVE_MODEL_FILE.read_text(encoding="utf-8"))
        model = data.get("model")
        if isinstance(model, str) and model.strip():
            return canonicalize_model_name(model)
    except (OSError, ValueError, TypeError):
        pass
    return canonicalize_model_name(settings.OLLAMA_MODEL)


def persist_active_model(model: str) -> None:
    canonical = canonicalize_model_name(model)
    _ACTIVE_MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = _ACTIVE_MODEL_FILE.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps({"model": canonical}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, _ACTIVE_MODEL_FILE)


async def list_installed_models(client: OllamaClient | None = None) -> list[str]:
    ollama = client or OllamaClient()
    return sorted({canonicalize_model_name(model) for model in await ollama.list_models()})


async def ensure_active_model_on_gpu(client: OllamaClient | None = None) -> str:
    """Load the persisted active model and fail unless Ollama reports VRAM use."""
    ollama = client or OllamaClient()
    active = get_active_model()
    available = await list_installed_models(ollama)
    if active not in available:
        raise OllamaModelError(404, f"Model aktif '{active}' tidak terpasang di Ollama.")

    await ollama.load_model(active)
    if not await ollama.is_model_on_gpu(active):
        try:
            await ollama.unload_model(active)
        except Exception:
            logger.warning("Gagal melepas model %s setelah gate GPU gagal.", active)
        raise OllamaGPUError(
            f"Model aktif '{active}' tidak menggunakan GPU (size_vram=0)."
        )
    return active


async def activate_model(model: str, client: OllamaClient | None = None) -> str:
    ollama = client or OllamaClient()
    requested = canonicalize_model_name(model)
    available = await list_installed_models(ollama)
    if requested not in available:
        raise MarsAPIError(404, "MODEL_NOT_FOUND", f"Model '{requested}' tidak ditemukan di Ollama.")

    old_model = get_active_model()
    await ollama.load_model(requested)
    if not await ollama.is_model_on_gpu(requested):
        try:
            await ollama.unload_model(requested)
        except Exception:
            logger.warning("Gagal melepas model %s setelah verifikasi GPU gagal.", requested)
        raise MarsAPIError(
            502,
            "GPU_REQUIRED",
            f"Model '{requested}' berhasil dimuat tetapi tidak menggunakan GPU.",
        )

    persist_active_model(requested)
    if old_model != requested:
        try:
            await ollama.unload_model(old_model)
        except Exception as exc:
            logger.warning("Model lama %s gagal dilepas: %s", old_model, exc)
    return requested
