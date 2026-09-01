from fastapi import APIRouter

from app.core.errors import MarsAPIError
from app.schemas.translate import BatchTranslateRequest, BatchTranslateResponse, BatchTranslateResult
from app.services.model_service import canonicalize_model_name, get_active_model
from app.services.profile_service import get_translation_profile
from app.services.translator_service import TranslatorService

router = APIRouter()


@router.post("/batch", response_model=BatchTranslateResponse)
async def batch_translate(payload: BatchTranslateRequest):
    active_model = get_active_model()
    requested_model = canonicalize_model_name(payload.model) if payload.model else active_model
    if requested_model != active_model:
        raise MarsAPIError(
            404,
            "MODEL_NOT_ACTIVE",
            f"Model '{requested_model}' bukan model aktif. Model aktif: '{active_model}'.",
        )

    service = TranslatorService(model=active_model)
    translations = await service.translate_batch(
        items=payload.items,
        mode=payload.mode,
        options=payload.options,
    )
    results = [
        BatchTranslateResult(
            id=item.id,
            original_text=item.text,
            translated_text=translations.get(item.id, item.text),
        )
        for item in payload.items
    ]
    return BatchTranslateResponse(
        results=results,
        model=active_model,
        translation_profile=get_translation_profile(active_model, payload.options),
    )
