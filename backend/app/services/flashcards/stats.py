from sqlalchemy.orm import Session

from backend.app.schemas.stats import StatsOverview
from backend.app.services.flashcards.deck_manager import DeckManager


def get_stats_overview(db: Session) -> StatsOverview:
    deck_manager = DeckManager(db)
    decks = deck_manager.list_decks()

    total_cards = 0
    mastered_cards = 0
    due_cards = 0

    for deck in decks:
        stats = deck_manager.get_deck_stats(deck.id)
        total_cards += stats.total
        mastered_cards += stats.mastered
        due_cards += stats.available_to_study

    return StatsOverview(
        total_decks=len(decks),
        total_cards=total_cards,
        mastered_cards=mastered_cards,
        due_cards=due_cards,
        total_exercises=0,
        completed_exercises=0,
    )
