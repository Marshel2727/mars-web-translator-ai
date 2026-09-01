from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.clients.ollama_client import OllamaClient, OllamaError
from app.core.config import settings
from app.core.errors import (
    MarsAPIError,
    mars_api_error_handler,
    ollama_error_handler,
    validation_error_handler,
)
from app.core.security import validate_security_settings
from app.services.cache_service import TranslationCacheService
from app.services.model_service import ensure_active_model_on_gpu


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_security_settings()
    await ensure_active_model_on_gpu()
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

app.add_exception_handler(MarsAPIError, mars_api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(OllamaError, ollama_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.MARS_EXTENSION_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Mars-Token"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
