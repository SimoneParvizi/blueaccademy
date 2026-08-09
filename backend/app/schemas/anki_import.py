from pydantic import BaseModel, ConfigDict, Field


class AnkiImportRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deck_id: int = Field(..., alias="deckId")
    content: str = Field(...)
    separator: str | None = Field(default="\t")

    @property
    def lines(self) -> list[str]:
        lines = [line for line in self.content.split("\n") if line.strip() and not line.startswith("#")]
        return lines


class AnkiImportResponse(BaseModel):
    imported: int
    errors: int
    error_details: list[str] = Field(alias="errorDetails")
