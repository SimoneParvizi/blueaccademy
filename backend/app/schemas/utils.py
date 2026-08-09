# TODO: if in the end the are not many differnt utils, this file should be named 'mappers'
from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.db.orm.deck import DeckORM
from backend.app.db.orm.flashcard import FlashcardORM
from backend.app.db.orm.flashcard_settings import FlashcardSettingsORM


def mapped_column_values(progress: CardProgressORM | FlashcardORM | DeckORM | FlashcardSettingsORM) -> dict:
    values = {column.name: getattr(progress, column.name) for column in progress.__table__.columns}
    return values
