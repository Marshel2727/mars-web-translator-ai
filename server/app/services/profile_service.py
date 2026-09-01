import hashlib
import json
from typing import Any

from app.core.config import settings
from app.core.prompts import PROMPT_VERSION
from app.services.glossary_service import GlossaryService

TRANSLATION_PROFILE_VERSION = "1"


def resolve_generation_options(options: Any = None) -> dict[str, int | float]:
    resolved: dict[str, int | float] = {
        "num_ctx": settings.DEFAULT_NUM_CTX,
        "num_predict": settings.DEFAULT_NUM_PREDICT,
        "temperature": 0.1,
        "top_p": 0.9,
    }
    if options is None:
        return resolved

    for field in resolved:
        value = options.get(field) if isinstance(options, dict) else getattr(options, field, None)
        if value is not None:
            resolved[field] = value
    return resolved


def get_translation_profile(model: str, options: Any = None) -> str:
    payload = {
        "version": TRANSLATION_PROFILE_VERSION,
        "prompt_version": PROMPT_VERSION,
        "glossary_digest": GlossaryService.digest(),
        "model": model,
        "options": resolve_generation_options(options),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
