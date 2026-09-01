from dataclasses import dataclass

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.clients.ollama_client import OllamaError, OllamaModelError, OllamaTimeoutError


@dataclass
class MarsAPIError(Exception):
    status_code: int
    code: str
    detail: str

    def __str__(self) -> str:
        return self.detail


async def mars_api_error_handler(_request: Request, exc: MarsAPIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
    )


async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = [
        {
            "type": error.get("type", "value_error"),
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg", "Payload tidak valid."),
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"detail": details, "code": "VALIDATION_ERROR"},
    )


async def ollama_error_handler(_request: Request, exc: OllamaError) -> JSONResponse:
    if isinstance(exc, OllamaTimeoutError):
        status_code, code = 504, "OLLAMA_TIMEOUT"
    elif isinstance(exc, OllamaModelError):
        status_code, code = 502, "OLLAMA_MODEL_ERROR"
    else:
        status_code, code = 502, "OLLAMA_UNAVAILABLE"
    return JSONResponse(
        status_code=status_code,
        content={"detail": str(exc), "code": code},
    )
