from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from backend.app.db.orm.deck import DeckORM
from backend.app.schemas.utils import mapped_column_values


class DeckContent(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, str_strip_whitespace=True)

    id: int
    title: str
    description: str = ""
    track: str
    card_count: int = Field(default=0, alias="cardCount")

    @classmethod
    def from_orm(cls, obj: DeckORM) -> Self:
        deck_content = cls(**mapped_column_values(obj))
        # logger.info()
        return deck_content

    @classmethod
    def from_list_orm(cls, list_orm: list[DeckORM]) -> list[Self]:
        list_cards = []
        for card_orm in list_orm:
            list_cards.append(cls.from_orm(card_orm))
            # logger.info()
        return list_cards


class DeckCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str
    description: str = ""
    track: str


class DeckStats(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    total: int = Field(default=0)
    mastered: int = Field(default=0)
    available_to_study: int = Field(default=0)
    # TODO: in the future change the aliases and be sure that doens't have influences on the db
    new_left_today: int = Field(default=0, alias="newAvailable")
    due_progress_learn: int = Field(default=0, alias="learnDue")
    due_progress_review: int = Field(default=0, alias="reviewDue")
    seen_count: int = Field(default=0, alias="seenCount")
