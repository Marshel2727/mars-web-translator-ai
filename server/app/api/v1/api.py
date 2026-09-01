from fastapi import APIRouter, Depends

from app.api.v1.endpoints import cache, health, models, translate, ws
from app.core.security import require_api_access

api_router = APIRouter()

_protected = [Depends(require_api_access)]

api_router.include_router(health.router, prefix="/health", tags=["Health"], dependencies=_protected)
api_router.include_router(translate.router, prefix="/translate", tags=["Translate"], dependencies=_protected)
api_router.include_router(cache.router, prefix="/cache", tags=["Cache"], dependencies=_protected)
api_router.include_router(models.router, prefix="/models", tags=["Models"], dependencies=_protected)
api_router.include_router(ws.router, prefix="/ws", tags=["WebSocket"])
