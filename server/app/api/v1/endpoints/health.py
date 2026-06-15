from fastapi import APIRouter


router = APIRouter()


@router.get("/")
def health_check():
    return {
        "status": "ok",
        "message": "Mars Web Translator AI server is running",
    }