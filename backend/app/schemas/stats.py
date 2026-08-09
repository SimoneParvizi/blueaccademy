from pydantic import BaseModel


class StatsOverview(BaseModel):
    total_decks: int
    total_cards: int
    mastered_cards: int
    due_cards: int
    total_exercises: int
    completed_exercises: int
