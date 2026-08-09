from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from backend.app.db.orm.flashcard_settings import FlashcardSettingsORM
from backend.app.schemas.utils import mapped_column_values


class FlashcardSettingsContent(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    # TODO: Add detaield description for all
    new_cards_per_day: int = Field(alias="newCardsPerDay", description="")
    learning_steps: str = Field(
        alias="learningSteps",
        description="Short time delays for cards that are still being learned, like `10m 1d 3d`. "
        "Good answers move the card to the next step. After the last step the card gets promoted"
        "to Review state.",
    )
    relearning_steps: str = Field(
        alias="relearningSteps", description="Short time delays for cards being relearned after forgetting them."
    )
    minimum_interval: int = Field(
        alias="minimumInterval", description="The smallest allowed review interval, in days, when scheduling a review card."
    )
    easy_review_interval: int = Field(
        alias="easyReviewInterval", description="The review interval, in days, used when a card is marked easy."
    )
    normal_review_interval: int = Field(
        alias="normalReviewInterval",
        description="The first long-term review interval, in days, after a card finishes its learning steps.",
    )

    @classmethod
    def from_orm(cls, obj: FlashcardSettingsORM) -> Self:
        settings_content = cls(**mapped_column_values(obj))
        return settings_content


class FlashcardSettingsUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    new_cards_per_day: int = Field(ge=0, le=999, alias="newCardsPerDay")
    learning_steps: str = Field(alias="learningSteps")
    relearning_steps: str = Field(alias="relearningSteps")
    minimum_interval: int = Field(ge=1, alias="minimumInterval")
    easy_review_interval: int = Field(ge=1, alias="easyReviewInterval")
    normal_review_interval: int = Field(ge=1, alias="normalReviewInterval")
