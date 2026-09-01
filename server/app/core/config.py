from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "Mars Web Translator AI"
    APP_ENV: str = "development"
    
    API_V1_PREFIX: str = "/api/v1"
    
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mars-translator-qwen3:latest"
    OLLAMA_CONNECT_TIMEOUT: float = 5.0
    
    REQUEST_TIMEOUT: int = 120  # seconds
    MAX_BATCH_ITEMS: int = 20
    DEFAULT_NUM_CTX: int = 8192
    DEFAULT_NUM_PREDICT: int = 2048
    MAX_BATCH_CHARS: int = 4000  # max total chars per chunk in batch translation

    MARS_API_TOKEN: str = ""
    MARS_ALLOWED_ORIGINS: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5173,http://127.0.0.1:5173"
    )
    MARS_EXTENSION_ORIGIN_REGEX: str = r"^chrome-extension://[a-p]{32}$"

    @property
    def allowed_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.MARS_ALLOWED_ORIGINS.split(",")
            if origin.strip()
        ]

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
