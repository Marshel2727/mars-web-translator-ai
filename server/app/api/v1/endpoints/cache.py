from fastapi import APIRouter

from app.services.cache_service import TranslationCacheService

router = APIRouter()


@router.get("/stats")
async def cache_stats():
    cache = TranslationCacheService()
    stats = await cache.get_stats()
    return stats


@router.delete("/clear")
async def clear_cache():
    cache = TranslationCacheService()
    await cache.clear()
    return {"status": "ok", "message": "Translation cache cleared"}
