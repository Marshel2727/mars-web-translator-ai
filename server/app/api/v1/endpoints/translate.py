from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.translate import (
    BatchTranslateRequest,
    BatchTranslateResponse,
    BatchTranslateResult,
)
from app.services.translator_service import TranslatorService


router = APIRouter()


@router.post("/batch", response_model=BatchTranslateResponse)
async def batch_translate(payload: BatchTranslateRequest):
    if len(payload.items) > settings.MAX_BATCH_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f"Maksimal {settings.MAX_BATCH_ITEMS} item per batch.",
        )

    service = TranslatorService()
    results: list[BatchTranslateResult] = []
    translations = await service.translate_batch(
        items=payload.items,
        mode=payload.mode,
    )

    for item in payload.items:
        results.append(
            BatchTranslateResult(
                id=item.id,
                original_text=item.text,
                translated_text=translations.get(item.id, item.text),
            )
        )

    return BatchTranslateResponse(
        results=results,
        model=settings.OLLAMA_MODEL,
    )
