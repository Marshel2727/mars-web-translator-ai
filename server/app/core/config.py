from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    APP_NAME: str = "Mars Web Translator AI"
    APP_ENV: str = "development"
    
    API_V1_PREFIX: str = "/api/v1"
    
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mars-translator:qwen2.5-3b"
    
    REQUEST_TIMEOUT: int = 120  # seconds
    MAX_BATCH_ITEMS: int = 20

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
