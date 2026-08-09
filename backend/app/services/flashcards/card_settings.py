import logging

from sqlalchemy.orm import Session

from backend.app.db.orm.flashcard_settings import FlashcardSettingsORM
from backend.app.schemas.flashcard_settings import FlashcardSettingsUpdate

logger = logging.getLogger(__name__)


def get_flashcards_settings(db: Session) -> FlashcardSettingsORM:
    settings = db.get(FlashcardSettingsORM, 1)
    logger.info(f"Settings for flashcards: {settings}")
    if settings is None:
        settings = FlashcardSettingsORM()
        db.add(settings)
        db.commit()
        db.refresh(settings)
        logger.info(f"Commited settings for flashcards: {settings}")

    return settings


def update_fields(settings, payload: FlashcardSettingsUpdate):
    settings.new_cards_per_day = payload.new_cards_per_day
    settings.learning_steps = payload.learning_steps.strip()
    settings.normal_review_interval = payload.normal_review_interval
    settings.easy_interval = payload.easy_review_interval
    settings.relearning_steps = payload.relearning_steps.strip()
    settings.minimum_interval = payload.minimum_interval
    return settings


def update_flashcard_settings(db: Session, payload: FlashcardSettingsUpdate) -> FlashcardSettingsORM:
    settings = get_flashcards_settings(db)
    settings = update_fields(settings, payload)
    db.commit()
    db.refresh(settings)
    logger.info(f"Commited updated settings for flashcards: {settings}")
    return settings
