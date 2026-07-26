from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TranslateItem(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class OllamaOptionsPayload(BaseModel):
    """Optional Ollama inference parameters sent from the extension settings."""
    num_ctx: int | None = Field(default=None, ge=128, le=65536, description="Context window size (tokens).")
    num_predict: int | None = Field(default=None, ge=1, le=2048, description="Max tokens to generate.")
    temperature: float | None = Field(default=None, ge=0.0, le=2.0, description="Sampling temperature.")
    top_p: float | None = Field(default=None, ge=0.0, le=1.0, description="Nucleus sampling top-p.")
    keep_alive: str | None = Field(default=None, description="Duration to keep model in VRAM, e.g. '30m', '1h', '0m'.")


class BatchTranslateRequest(BaseModel):
    mode: Literal["translate", "explain"] = Field(default="translate")
    items: list[TranslateItem]
    model: str | None = Field(default=None)
    options: OllamaOptionsPayload | None = Field(default=None)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "BatchTranslateRequest":
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
