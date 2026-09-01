from pydantic import BaseModel, Field

MODEL_PATTERN = r"^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$"

class ModelListResponse(BaseModel):
    active_model: str
    models: list[str]

class SetActiveModelRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=200, pattern=MODEL_PATTERN)

class SetActiveModelResponse(BaseModel):
    status: str
    active_model: str
