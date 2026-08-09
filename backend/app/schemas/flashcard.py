from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from backend.app.db.orm.flashcard import FlashcardORM
from backend.app.schemas.utils import mapped_column_values


class FlashcardContent(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True, populate_by_name=True)

    id: int | None = None
    deck_id: int = Field(alias="deckId")
    front: str = Field(...)
    back: str = Field(...)
    code_example: str | None = Field(default=None, alias="codeExample")
    difficulty: str = "medium"
    tags: str = "[]"

    @classmethod
    def from_orm(cls, obj: FlashcardORM) -> Self:
        flashcard_content = cls(**mapped_column_values(obj))
        return flashcard_content

    @classmethod
    def from_list_orm(cls, list_orm: list[FlashcardORM]) -> list[Self]:
        list_cards = []
        for card_orm in list_orm:
            list_cards.append(cls.from_orm(card_orm))
        return list_cards


class FlashcardCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, populate_by_name=True)

    front: str = Field(...)
    back: str = Field(...)
    code_example: str | None = Field(default=None, alias="codeExample")
    difficulty: str = "medium"
    tags: str = "[]"
