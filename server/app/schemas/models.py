from pydantic import BaseModel, Field

class ModelListResponse(BaseModel):
    active_model: str
    models: list[str]

class SetActiveModelRequest(BaseModel):
    model: str = Field(..., min_length=1)

class SetActiveModelResponse(BaseModel):
    status: str
    active_model: str
