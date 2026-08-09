import logging

from backend.app.schemas.flashcard_settings import FlashcardSettingsContent
from backend.app.services.flashcards.types import ReviewerCardProgress, State
from backend.app.services.utils import TimeUnits

logger = logging.getLogger(__name__)


class LearningStepsProgress:
    """Learning steps are the first few delays showed when the user is being shown a card for the first time.
    Passed that, the card becomes part of the normal review cycle, which is interval-based and not step-based."""

    DEFAULT_FIRST_STEP = 10  # It's 10m in the default [10m, 1d, 3d]
    FIRST_STEP_INDEX = 0

    def __init__(self, state: State, settings: FlashcardSettingsContent, card_progress: ReviewerCardProgress):
        if state in {State.LEARN, State.NEW}:
            steps = settings.learning_steps
        elif state == State.RELEARN:
            steps = settings.relearning_steps
        else:
            raise ValueError(f"Invalid state `{state}` for learning/re-learning.")

        self.learning_steps = steps.split()  # -> [`10m`, `1d`, `3d`]
        self.steps = self.to_minutes()
        self.card_progress = card_progress

    def to_minutes(self) -> list[int]:
        """Converts the learning/relearning delays str ("10m 1h 3d") into a list of minutes [10, 60, 4320]."""
        learning_steps_list = []
        for step in self.learning_steps:
            step = step.strip()
            time_value = int(step[:-1])
            time_unit = step[-1]
            time_unit = TimeUnits(time_unit)
            time_unit = time_unit.to_minutes(time_value)
            learning_steps_list.append(time_unit)
        logger.info(f"Learning steps: {learning_steps_list}")
        return learning_steps_list

    @property
    def current_step(self) -> int:
        current_index = self.card_progress.step_index
        logger.info(f"Current step: {self.steps[current_index]}")
        return self.steps[current_index]

    @property
    def previous_step(self) -> int | None:
        if self.is_first_step():
            logger.info("Current is first step. No previous step.")
            return None
        else:
            index = self.card_progress.step_index
            logger.info(f"Previous step: {self.steps[index - 1]}")
            return self.steps[index - 1]

    @property
    def next_step(self) -> int | None:
        if self.is_last_step():
            logger.info("No next step.")
            return None
        else:
            next_index = self.card_progress.next_index
            logger.info(f"Next step: {self.steps[next_index]}")
            return self.steps[next_index]

    @property
    def first_step(self) -> int:
        first_step = self.steps[0] if self.steps else self.DEFAULT_FIRST_STEP
        logger.info(f"First step: {first_step}")
        return first_step

    def is_first_step(self) -> bool:
        return self.card_progress.step_index == 0

    @property
    def last_step(self) -> int:
        last_step = self.steps[-1] if self.steps else self.DEFAULT_FIRST_STEP
        logger.info(f"Last step: {last_step}")
        return last_step

    def is_last_step(self) -> bool:
        return self.card_progress.step_index == len(self.steps) - 1
