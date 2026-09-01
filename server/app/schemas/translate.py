from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.config import settings
from app.schemas.models import MODEL_PATTERN

KEEP_ALIVE_PATTERN = r"^(?:0|\d+(?:\.\d+)?(?:ms|s|m|h))$"


class TranslateItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    text: str = Field(..., min_length=1, max_length=4000)


class OllamaOptionsPayload(BaseModel):
    """Optional Ollama inference parameters sent from the extension settings."""
    num_ctx: int | None = Field(default=None, ge=128, le=65536, description="Context window size (tokens).")
    num_predict: int | None = Field(default=None, ge=1, le=2048, description="Max tokens to generate.")
    temperature: float | None = Field(default=None, ge=0.0, le=2.0, description="Sampling temperature.")
    top_p: float | None = Field(default=None, ge=0.0, le=1.0, description="Nucleus sampling top-p.")
    keep_alive: str | None = Field(
        default=None,
        max_length=32,
        pattern=KEEP_ALIVE_PATTERN,
        description="Duration to keep model in VRAM, e.g. '30m', '1h', '0'.",
    )


class BatchTranslateRequest(BaseModel):
    mode: Literal["translate", "explain"] = Field(default="translate")
    items: list[TranslateItem] = Field(..., min_length=1, max_length=20)
    model: str | None = Field(
        default=None, min_length=1, max_length=200, pattern=MODEL_PATTERN
    )
    options: OllamaOptionsPayload | None = Field(default=None)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "BatchTranslateRequest":
        if len(self.items) > settings.MAX_BATCH_ITEMS:
            raise ValueError(f"Maksimal {settings.MAX_BATCH_ITEMS} item per batch.")

        total_chars = sum(len(item.text) for item in self.items)
        if total_chars > 40000:
            raise ValueError("Total teks per request maksimal 40000 karakter.")

        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            duplicates = [id for id in ids if ids.count(id) > 1]
            raise ValueError(f"Duplicate item IDs found: {set(duplicates)}")
        return self


class BatchTranslateResult(BaseModel):
    id: str
    original_text: str
    translated_text: str

class BatchTranslateResponse(BaseModel):
    results: list[BatchTranslateResult]
    model: str
    translation_profile: str
