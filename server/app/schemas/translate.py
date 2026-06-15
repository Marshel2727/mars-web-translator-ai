from pydantic import BaseModel, Field

class TranslateItem(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    
    
class BatchTranslateRequest(BaseModel):
    mode: str = Field(default="translate")
    items: list[TranslateItem]

class BatchTranslateResult(BaseModel):
    id: str
    original_text: str
    translated_text: str
    
class BatchTranslateResponse(BaseModel):
    results: list[BatchTranslateResult]
    model: str
