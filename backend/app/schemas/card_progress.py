from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.schemas.utils import mapped_column_values
from backend.app.services.flashcards.defaults import defaults
from backend.app.services.flashcards.types import Rating


# TODO: refactor the name of this class to CardProgressContent
class CardProgressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    card_id: int = Field(alias="cardId")
    stored_review_interval: int
    easy_multiplier: float = Field(alias="easeFactor")
    repetitions: int
    show_again_at: int = Field(alias="nextReview")
    first_reviewed_at: int | None = Field(alias="firstReviewedAt")
    state: str
    step_index: int | None = Field(alias="stepIndex")
    failures_while_review: int = Field(alias="lapseCount")
    last_rating: int | None = Field(alias="lastRating")

    @classmethod
    def from_orm(cls, obj: CardProgressORM) -> Self:
        card_progress_content = cls(**mapped_column_values(obj))
        # logger.info()
        return card_progress_content


# TODO: refactor the name of this class
class CardProgressWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    interval: int = 1
    easy_multiplier: float = Field(default=defaults.easy_multiplier, alias="easeFactor")
    repetitions: int = 0
    show_again_at: int = Field(default=defaults.show_again_at, alias="nextReview")
    first_reviewed_at: int | None = Field(default=None, alias="firstReviewedAt")
    state: str = "review"
    step_index: int | None = Field(default=None, alias="stepIndex")
    failures_while_review: int = Field(default=defaults.failures_while_review, alias="lapseCount")
    last_rating: int | None = Field(default=None, alias="lastRating")


# TODO: to remove and refactor in the future. Too many abstractions
class ReviewRequest(BaseModel):
    rating: Rating


class ReviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    progress: CardProgressRead
    previous_progress: CardProgressRead | None = Field(alias="previousProgress")
    next_interval: str = Field(alias="nextInterval")


class RestoreProgressRequest(BaseModel):
    progress: CardProgressWrite | None = None
