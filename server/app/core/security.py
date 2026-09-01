import re
import secrets

from fastapi import Header, Request, WebSocket

from app.core.config import settings
from app.core.errors import MarsAPIError


def validate_security_settings() -> None:
    token = settings.MARS_API_TOKEN.strip()
    if len(token) < 32:
        raise RuntimeError(
            "MARS_API_TOKEN wajib diisi minimal 32 karakter di server/.env. "
            "Buat token dengan: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )


def _origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True

    if re.fullmatch(settings.MARS_EXTENSION_ORIGIN_REGEX, origin):
        return True

    return origin in settings.allowed_origins


def _token_valid(token: str | None) -> bool:
    if not token:
        return False
    return secrets.compare_digest(token, settings.MARS_API_TOKEN)


async def require_api_access(
    request: Request,
    x_mars_token: str | None = Header(default=None, alias="X-Mars-Token"),
) -> None:
    if request.method == "OPTIONS":
        return

    if not _token_valid(x_mars_token):
        raise MarsAPIError(401, "AUTH_INVALID", "Token API tidak ada atau tidak valid.")

    if not _origin_allowed(request.headers.get("origin")):
        raise MarsAPIError(403, "ORIGIN_FORBIDDEN", "Origin request tidak diizinkan.")


def websocket_origin_allowed(websocket: WebSocket) -> bool:
    return _origin_allowed(websocket.headers.get("origin"))


def websocket_token_valid(token: str | None) -> bool:
    return _token_valid(token)
