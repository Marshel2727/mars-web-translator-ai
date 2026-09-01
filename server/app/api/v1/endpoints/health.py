from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.clients.ollama_client import OllamaClient, OllamaError
from app.core.config import settings
from app.services.model_service import get_active_model, list_installed_models
from app.services.profile_service import get_translation_profile

router = APIRouter()


async def get_health_payload() -> tuple[dict, bool]:
    active = get_active_model()
    client = OllamaClient()
    ollama_state: dict[str, str] = {"status": "ok"}
    installed = False
    on_gpu = False

    try:
        models = await list_installed_models(client)
        installed = active in models
        on_gpu = installed and await client.is_model_on_gpu(active)
    except OllamaError as exc:
        ollama_state = {"status": "unavailable", "detail": str(exc)}

    healthy = ollama_state["status"] == "ok" and installed and on_gpu
    payload = {
        "status": "ok" if healthy else "degraded",
        "message": (
            "Mars Web Translator AI siap digunakan"
            if healthy
            else "Backend aktif, tetapi dependensi terjemahan belum siap"
        ),
        "ollama": ollama_state,
        "active_model": {
            "name": active,
            "installed": installed,
            "gpu": on_gpu,
        },
        "translation_profile": get_translation_profile(active),
        "app_name": settings.APP_NAME,
    }
    return payload, healthy


@router.get("/")
async def health_check():
    payload, healthy = await get_health_payload()
    return JSONResponse(status_code=200 if healthy else 503, content=payload)
