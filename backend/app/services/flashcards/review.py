import logging

from sqlalchemy.orm import Session

from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.schemas.flashcard_settings import FlashcardSettingsContent
from backend.app.schemas.utils import mapped_column_values
from backend.app.services.flashcards.card_manager import CardManager
from backend.app.services.flashcards.card_settings import get_flashcards_settings
from backend.app.services.flashcards.scheduler import CardScheduler, SchedulerResult
from backend.app.services.flashcards.types import Rating, ReviewerCardProgress
from backend.app.services.utils import now_ms

logger = logging.getLogger(__name__)


class CardReviewer:
    """
    User reviewed card X and gave rating Y. How should DB card's progress change?
    """

    def __init__(self, db: Session):
        self.db = db
        self.settings = self.validate_settings()

    @staticmethod
    def snapshot_progress(progress_orm: CardProgressORM | None) -> CardProgressORM | None:
        """
        If the user wants to undo the review, it's necessary to have a snapshot of the previous progress to revert to.
        """
        if progress_orm is None:
            logger.info(f"Card progress is None: {progress_orm}")
            return None
        values = mapped_column_values(progress_orm)
        logger.info(f"Snapshot progress for {progress_orm.card_id} : {values}")
        return CardProgressORM(**values)

    def validate_settings(self):
        settings_orm = get_flashcards_settings(self.db)
        settings = FlashcardSettingsContent.model_validate(settings_orm)
        return settings

    @staticmethod
    def update_progress(
        progress_orm: CardProgressORM,
        scheduled: SchedulerResult,
        existing: CardProgressORM | None,
        rating: Rating,
    ) -> CardProgressORM:

        progress_orm.state = scheduled.state.value
        progress_orm.step_index = scheduled.step_index
        progress_orm.stored_review_interval = scheduled.stored_review_interval
        progress_orm.easy_multiplier = scheduled.easy_multiplier
        progress_orm.repetitions = scheduled.repetitions
        progress_orm.show_again_at = scheduled.show_again_at
        progress_orm.first_reviewed_at = existing.first_reviewed_at if existing else now_ms()
        progress_orm.failures_while_review = scheduled.failures_while_review
        progress_orm.last_rating = rating.value
        logger.info(f"Updated progress for {progress_orm.card_id}: {progress_orm}")
        return progress_orm

    def show_ratings_preview(self, card_id: int) -> dict[int, str]:
        card_manager = CardManager(self.db)
        card_manager.ensure_card_exists(card_id)
        existing = card_manager.get_card_progress(card_id)
        card_progress = ReviewerCardProgress.from_db(existing)
        scheduler = CardScheduler(card_progress, self.settings)
        previews = scheduler.show_previews()
        logger.info(f"Previews for {card_id}: {previews}")
        return previews

    def review(self, card_id: int, rating: Rating) -> tuple[CardProgressORM, CardProgressORM | None, str]:
        """
        - input: current review state + user rating
        - output: next review plan/state
        """
        card_manager = CardManager(self.db)
        card_manager.ensure_card_exists(card_id)
        existing = card_manager.get_card_progress(card_id)
        previous_progress = self.snapshot_progress(existing)

        if existing is None:
            logger.info(f"Card progress is None: {existing}")
            progress_orm = CardProgressORM(card_id=card_id)
            self.db.add(progress_orm)
        else:
            logger.info(f"Card progress is already present: {existing}")
            progress_orm = existing

        card_progress = ReviewerCardProgress.from_db(progress_orm)

        scheduler = CardScheduler(card_progress, self.settings)
        scheduled_card = scheduler.schedule(rating)
        updated_progress_orm = self.update_progress(progress_orm, scheduled_card, existing, rating)

        self.db.commit()
        self.db.refresh(updated_progress_orm)
        logger.info(f"Committed updated progress for {card_id}: {updated_progress_orm}")

        return updated_progress_orm, previous_progress, scheduled_card.preview
