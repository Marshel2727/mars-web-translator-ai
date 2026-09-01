from fastapi import APIRouter

from app.clients.ollama_client import OllamaClient
from app.schemas.models import ModelListResponse, SetActiveModelRequest, SetActiveModelResponse
from app.services.model_service import activate_model, get_active_model, list_installed_models

router = APIRouter()


@router.get("/", response_model=ModelListResponse)
async def list_models():
    models = await list_installed_models(OllamaClient())
    return ModelListResponse(active_model=get_active_model(), models=models)


@router.post("/active", response_model=SetActiveModelResponse)
async def set_active_model(payload: SetActiveModelRequest):
    active = await activate_model(payload.model, OllamaClient())
    return SetActiveModelResponse(status="ok", active_model=active)
