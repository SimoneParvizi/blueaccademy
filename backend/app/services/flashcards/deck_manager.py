import logging

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.db.orm.deck import DeckORM
from backend.app.db.orm.flashcard import FlashcardORM
from backend.app.schemas.deck import DeckCreate, DeckStats
from backend.app.services.exceptions import DeckNotFoundError
from backend.app.services.flashcards.card_manager import CardManager, to_dict
from backend.app.services.flashcards.card_settings import get_flashcards_settings
from backend.app.services.flashcards.types import Queue
from backend.app.services.utils import now_ms

logger = logging.getLogger(__name__)


def recompute_cards_count(db: Session, deck: DeckORM) -> int:
    fallback = 0
    recount = db.scalar(select(func.count()).select_from(FlashcardORM).where(FlashcardORM.deck_id == deck.id))

    return recount or fallback


def get_due_progress_for_deck(db: Session, deck_id: int) -> list[CardProgressORM]:
    """Get progress rows for cards in this deck that are due now."""
    query = (
        select(CardProgressORM)
        .join(FlashcardORM, FlashcardORM.id == CardProgressORM.card_id)
        .where(
            FlashcardORM.deck_id == deck_id,
            CardProgressORM.show_again_at <= now_ms(),
        )
    )
    rows = list(db.scalars(query).all())
    return rows


def get_deck_progress(db: Session, deck_id: int) -> list[CardProgressORM]:
    """Get progress rows for cards in this deck."""
    query = (
        select(CardProgressORM)
        .join(FlashcardORM, FlashcardORM.id == CardProgressORM.card_id)
        .where(FlashcardORM.deck_id == deck_id)
    )
    rows = list(db.scalars(query).all())
    return rows


class DeckManager:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_flashcards_settings(self.db)

    def list_flashcards(self, deck_id: int) -> list[FlashcardORM]:
        query = select(FlashcardORM).where(FlashcardORM.deck_id == deck_id).order_by(FlashcardORM.id.asc())
        list_cards = list(self.db.scalars(query).all())
        logger.info(f"Found {len(list_cards)} flashcards in deck {deck_id}")
        return list_cards

    def get_deck(self, deck_id: int) -> DeckORM:
        deck = self.db.get(DeckORM, deck_id)
        if deck is not None:
            logger.info(f"Found deck with id {deck_id}")
            return deck
        else:
            raise DeckNotFoundError(f"Deck with id {deck_id} not found")

    def list_decks(self, track: str | None = None) -> list[DeckORM]:
        query = select(DeckORM).order_by(DeckORM.id.asc())
        if track:
            query = query.where(DeckORM.track == track)

        list_decks = list(self.db.scalars(query).all())
        logger.info(f"Found {len(list_decks)} decks in track {track}")
        return list_decks

    def create_deck(self, payload: DeckCreate) -> DeckORM:
        deck = DeckORM(
            title=payload.title,
            description=payload.description,
            track=payload.track,
            card_count=0,
        )
        logger.info(f"Created deck: {deck}")
        self.db.add(deck)
        self.db.commit()
        self.db.refresh(deck)
        logger.info(f"Commited deck {deck} to database")
        return deck

    def rename_deck(self, title: str, deck_id: int) -> DeckORM:
        deck_orm = self.get_deck(deck_id)
        logger.info(f"Renaming deck {deck_id} with title {title}")
        deck_orm.title = title
        self.db.commit()
        self.db.refresh(deck_orm)
        logger.info(f"Commited deck {deck_orm} to database")
        return deck_orm

    def update_deck_track(self, track: str, deck_id: int) -> DeckORM:
        deck_orm = self.get_deck(deck_id)
        logger.info(f"Updating deck {deck_id} with track {track}")
        deck_orm.track = track
        self.db.commit()
        self.db.refresh(deck_orm)
        logger.info(f"Commited deck {deck_orm} to database")
        return deck_orm

    def delete_deck(self, deck_id: int) -> bool:
        deck_orm = self.get_deck(deck_id)
        cards = self.list_flashcards(deck_id)
        card_manager = CardManager(self.db)
        logger.info(f"Starting to delete {len(cards)} cards in deck {deck_id}")
        try:
            for card in cards:
                progress = card_manager.get_card_progress(card.id)
                if progress is not None:
                    self.db.delete(progress)
                    logger.info(f"Deleted progress for card {card.id}")
                self.db.delete(card)
                logger.info(f"Deleted card {card.id}")

            # Flush child-row deletes before removing the parent deck to satisfy FK constraints.
            self.db.flush()
            self.db.delete(deck_orm)
            self.db.commit()
            logger.info(f"Commited deck {deck_orm} to database")
            return True
        except SQLAlchemyError as e:
            self.db.rollback()
            logger.error(f"Could not delete deck {deck_id}: {e}")
            return False

    def get_deck_stats(self, deck_id: int) -> DeckStats:
        deck_orm = self.get_deck(deck_id)
        cards_count = recompute_cards_count(self.db, deck_orm)
        logger.info(f"Checking deck stats for {deck_id}")

        if cards_count == 0:
            logger.info(f"No cards in deck {deck_id}. Setting up default deck stats")
            return DeckStats()  # defaults are all 0

        cards_with_progress = get_deck_progress(self.db, deck_id)
        all_cards = self.list_flashcards(deck_id)
        card_manager = CardManager(self.db)

        introduced_today_count = 0
        due_progress_learn = 0
        due_progress_review = 0
        never_introduced = 0

        for card in all_cards:
            queue, introduced_today = card_manager.categorize_card(card)

            if introduced_today:
                introduced_today_count += 1
                logger.info(f"Introduced today: {introduced_today_count}")

            if queue == Queue.NEW:
                never_introduced += 1
            elif queue == Queue.LEARN:
                due_progress_learn += 1
            elif queue == Queue.DUE:
                due_progress_review += 1

        remaining_new_cards = max(0, self.settings.new_cards_per_day - introduced_today_count)
        new_left_today = min(never_introduced, remaining_new_cards)

        available_to_study = new_left_today + due_progress_learn + due_progress_review
        mastered = sum(1 for card in cards_with_progress if card.repetitions >= 3 and card.state == "review")

        deck_stats = DeckStats(
            total=cards_count,
            mastered=mastered,
            available_to_study=available_to_study,
            new_left_today=new_left_today,  # ty: ignore[unknown-argument]
            due_progress_learn=due_progress_learn,  # ty: ignore[unknown-argument]
            due_progress_review=due_progress_review,  # ty: ignore[unknown-argument]
            seen_count=len(cards_with_progress),  # ty: ignore[unknown-argument]
        )

        logger.info(f"Stats of deck {deck_id}: {deck_stats} ")
        return deck_stats

    def get_due_cards(self, deck_id: int) -> list[dict]:
        all_cards = self.list_flashcards(deck_id)

        learning_due = []
        review_due = []
        new_cards = []
        introduced_today_count = 0

        card_manager = CardManager(self.db)
        for card in all_cards:
            queue, introduced_today = card_manager.categorize_card(card)
            card_dict = to_dict(card)
            if introduced_today:
                introduced_today_count += 1

            if queue == Queue.NEW:
                new_cards.append({**card_dict, "queue": Queue.NEW.value})

            elif queue == Queue.LEARN:
                learning_due.append({**card_dict, "queue": Queue.LEARN.value})

            elif queue == Queue.DUE:
                review_due.append({**card_dict, "queue": Queue.DUE.value})

            elif queue == Queue.SKIP:
                pass

        remaining_new_cards = max(0, self.settings.new_cards_per_day - introduced_today_count)
        unpacked_due_cards_dict = [*new_cards[:remaining_new_cards], *learning_due, *review_due]
        logger.info(f"Due cards for {deck_id}: {unpacked_due_cards_dict}")
        return unpacked_due_cards_dict
