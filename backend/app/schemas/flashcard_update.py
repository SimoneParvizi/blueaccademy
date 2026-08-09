from pydantic import BaseModel, ConfigDict, Field


class FlashcardUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    front: str | None = None
    back: str | None = None
    code_example: str | None = Field(default=None, alias="codeExample")
