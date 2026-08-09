from __future__ import annotations

import logging
from enum import Enum
from typing import TYPE_CHECKING, Self

from pydantic import BaseModel, Field

from backend.app.services.flashcards.defaults import defaults

if TYPE_CHECKING:
    from backend.app.schemas.card_progress import CardProgressORM

logger = logging.getLogger(__name__)


class State(Enum):
    NEW = "new"
    LEARN = "learn"
    RELEARN = "relearn"
    REVIEW = "review"


class Rating(Enum):
    BLACKOUT = 0
    HARD = 1
    GOOD = 2
    EASY = 3


class Queue(Enum):
    NEW = "new"
    LEARN = "learn"
    DUE = "due"
    SKIP = "skip"


class ReviewerCardProgress(BaseModel):
    state: State = Field(..., description="The state of the card.")
    step_index: int = Field(
        ge=0,
        description="what learning/relearning step is this card currently on. Once the card "
        "finishes them, it graduates to the review state and step_index becomes irrelevant.",
    )
    interval: int = Field(
        description="Card's last review gap. It is mainly used as the baseline for review scheduling and "
        "for going back into review from re-learning.",
    )
    easy_multiplier: float = Field(
        ge=defaults.min_easy_multiplier,
        description="How easy the card has proven to be over time. "
        "It is a multiplier that the CardScheduler() uses to grow intervals.",
    )
    repetitions: int = Field(
        description="For a learned card, how many successful reviews this card has? If in learning state is set to 0. "
    )
    failures_while_review: int = Field(
        description="How many times this card has been forgotten badly enough to go back into re-learning",
    )

    @property
    def next_index(self):
        return self.step_index + 1

    @property
    def reset_repetitions(self):
        return 0

    @property
    def repetitions_after_success(self):
        return self.repetitions + 1

    @property
    def repetitions_after_failure(self):
        return self.repetitions - 1

    @property
    def review_failures_after_failure(self):
        return self.failures_while_review + 1

    @classmethod
    def from_db(cls, progress_orm: CardProgressORM | None) -> Self:
        """Read card progress from database and for each None value, assign the default one. Return it a class instance."""
        fields = {
            "state": State(progress_orm.state) if progress_orm and progress_orm.state is not None else None,
            "step_index": progress_orm.step_index if progress_orm else None,
            "interval": progress_orm.stored_review_interval if progress_orm else None,
            "easy_multiplier": progress_orm.easy_multiplier if progress_orm else None,
            "repetitions": progress_orm.repetitions if progress_orm else None,
            "failures_while_review": progress_orm.failures_while_review if progress_orm else None,
        }

        for attribute, value in fields.items():
            if value is None:
                fields[attribute] = getattr(defaults, attribute)
        # logger.info()
        return cls(**fields)  # ty: ignore[invalid-argument-type]
