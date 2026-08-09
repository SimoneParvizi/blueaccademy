import logging

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.db.orm.deck import DeckORM
from backend.app.db.orm.flashcard import FlashcardORM
from backend.app.schemas.card_progress import CardProgressWrite
from backend.app.schemas.flashcard import FlashcardCreate
from backend.app.schemas.flashcard_update import FlashcardUpdate
from backend.app.services.exceptions import FlashcardNotFoundError
from backend.app.services.flashcards.types import Queue
from backend.app.services.utils import datetime_start_of_day_ms, now_ms

logger = logging.getLogger(__name__)


def recompute_cards_count(db: Session, deck: DeckORM) -> int:
    fallback = 0
    recount = db.scalar(select(func.count()).select_from(FlashcardORM).where(FlashcardORM.deck_id == deck.id))

    return recount or fallback


def to_dict(card: FlashcardORM) -> dict:
    return {
        "id": card.id,
        "deckId": card.deck_id,
        "front": card.front,
        "back": card.back,
        "codeExample": card.code_example,
        "difficulty": card.difficulty,
        "tags": card.tags,
    }


class CardManager:
    def __init__(self, db: Session) -> None:
        self.db = db

    def ensure_card_exists(self, card_id: int) -> None:
        card = self.db.get(FlashcardORM, card_id)
        if card is None:
            raise FlashcardNotFoundError(f"Card with id {card_id} not found")

    def get_card_progress(self, card_id: int) -> CardProgressORM:
        self.ensure_card_exists(card_id)
        progress_orm = self.db.scalar(select(CardProgressORM).where(CardProgressORM.card_id == card_id))
        logger.info(f"Card progress: {progress_orm}")
        return progress_orm  # ty: ignore[invalid-return-type]

    def get_flashcard(self, card_id: int) -> FlashcardORM:
        self.ensure_card_exists(card_id)
        card = self.db.get(FlashcardORM, card_id)
        logger.info(f"Flashcard: {card}")
        return card  # ty: ignore[invalid-return-type]

    def create_flashcard(self, deck_id: int, payload: FlashcardCreate) -> FlashcardORM:
        from backend.app.services.flashcards.deck_manager import DeckManager

        logger.info(f"Creating flashcard: {payload}")
        card_orm = FlashcardORM(
            deck_id=deck_id,
            front=payload.front,
            back=payload.back,
            code_example=payload.code_example,
            difficulty=payload.difficulty,
            tags=payload.tags,
        )
        deck_manager = DeckManager(self.db)
        try:
            self.db.add(card_orm)
            self.db.flush()
            logger.info(f"Added flashcard: {card_orm}")

            deck = deck_manager.get_deck(deck_id)
            deck.card_count = recompute_cards_count(self.db, deck)
            logger.info(f"Deck {deck_id} count: {deck.card_count}")

            self.db.commit()
            self.db.refresh(card_orm)
            logger.info(f"Updated flashcard: {card_orm}")
        except SQLAlchemyError as e:
            self.db.rollback()
            raise ValueError(f"Could not create flashcard in deck {deck_id}: {e}")
        return card_orm

    def delete_flashcard(self, card_id: int) -> bool:
        from backend.app.services.flashcards.deck_manager import DeckManager

        card_orm = self.get_flashcard(card_id)

        deck_manager = DeckManager(self.db)
        deck = deck_manager.get_deck(int(card_orm.deck_id))
        logger.info(f"For deck {card_orm.deck_id} deleting flashcard: {card_orm}")

        try:
            self.db.delete(card_orm)
            self.db.flush()
            logger.info(f"Deleted flashcard: {card_id}")

            if deck is not None:
                deck.card_count = recompute_cards_count(self.db, deck)
                logger.info(f"Deck {deck.id} count: {deck.card_count}")

            self.db.commit()
            return True
        except SQLAlchemyError:
            self.db.rollback()
            logger.error(f"Failed to delete flashcard: {card_id}")
            return False

    def update_flashcard(self, card_id: int, payload: FlashcardUpdate) -> FlashcardORM:
        card_orm = self.get_flashcard(card_id)
        logger.info(f"Fetched flashcard: {card_orm}")

        for attribute in payload.model_fields_set:
            payload_value = getattr(payload, attribute)
            logger.info(f"Setting {attribute} to {payload_value} to flashcard: {card_orm}")
            if payload_value is not None:
                setattr(card_orm, attribute, payload_value)
                logger.info(f"Updated flashcard: {card_orm}")

        self.db.commit()
        self.db.refresh(card_orm)
        logger.info(f"Commited {card_orm} to database")

        return card_orm

    def restore_card_progress(self, card_id: int, payload: CardProgressWrite | None) -> CardProgressORM | None:
        existing_progress = self.get_card_progress(card_id)

        if payload is None:
            # No saved progress should exist
            if existing_progress is not None:
                logger.info(f"Since payload is None (payload: {existing_progress}), not restoring")
                self.db.delete(existing_progress)
                self.db.commit()
            return None

        if existing_progress is None:
            existing_progress = CardProgressORM(card_id=card_id)
            logger.info(f"Existing progress: {existing_progress}")
            self.db.add(existing_progress)

        existing_progress.stored_review_interval = payload.interval
        existing_progress.easy_multiplier = payload.easy_multiplier
        existing_progress.repetitions = payload.repetitions
        existing_progress.show_again_at = payload.show_again_at
        existing_progress.first_reviewed_at = payload.first_reviewed_at
        existing_progress.state = payload.state
        existing_progress.step_index = payload.step_index
        existing_progress.failures_while_review = payload.failures_while_review
        existing_progress.last_rating = payload.last_rating
        logger.info(f"Restored progress: {existing_progress}")
        self.db.commit()
        self.db.refresh(existing_progress)
        logger.info(f"Commited {existing_progress} to database")

        return existing_progress

    def categorize_card(self, card: FlashcardORM) -> tuple[Queue, bool]:
        progress_orm = self.get_card_progress(card.id)
        if progress_orm is None:
            return Queue.NEW, False

        timestamp_exists = progress_orm.first_reviewed_at is not None
        was_introduced_today = progress_orm.first_reviewed_at >= datetime_start_of_day_ms() if timestamp_exists else False

        if progress_orm.show_again_at > now_ms():
            return Queue.SKIP, was_introduced_today

        if progress_orm.state in ["learn", "relearn"]:
            return Queue.LEARN, was_introduced_today

        else:
            return Queue.DUE, was_introduced_today
