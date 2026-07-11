from fastapi import APIRouter

from app.api.v1.endpoints import cache, health, translate

api_router = APIRouter()

api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(translate.router, prefix="/translate", tags=["Translate"])
api_router.include_router(cache.router, prefix="/cache", tags=["Cache"])