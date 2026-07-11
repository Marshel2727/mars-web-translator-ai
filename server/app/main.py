from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.clients.ollama_client import OllamaClient
from app.core.config import settings
from app.services.cache_service import TranslationCacheService


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    cache = TranslationCacheService()
    await cache.initialize()
    yield
    # Shutdown
    await cache.close()
    await OllamaClient.close()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
