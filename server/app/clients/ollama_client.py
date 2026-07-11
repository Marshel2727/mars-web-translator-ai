import httpx

from app.core.config import settings

class OllamaClient:
    _client: httpx.AsyncClient | None = None

    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        self.timeout = settings.REQUEST_TIMEOUT

    @classmethod
    def client(cls) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(
                timeout=settings.REQUEST_TIMEOUT,
                limits=httpx.Limits(
                    max_connections=5,
                    max_keepalive_connections=3,
                ),
            )
        return cls._client

    @classmethod
    async def close(cls) -> None:
        if cls._client is not None:
            await cls._client.aclose()
            cls._client = None
        
    async def generate(self, prompt: str, response_format: str | None = None) -> str:
        url = f"{self.base_url}/api/generate"
        
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "options": {
                "temperature": 0.0,
                "top_p": 0.8,
            },
        }

        if response_format:
            payload["format"] = response_format
        
        response = await self.client().post(url, json=payload)
        response.raise_for_status()
            
        data = response.json()
        return data.get("response", "").strip()
    
