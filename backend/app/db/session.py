from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import get_settings
from backend.app.db.orm.base import Base

settings = get_settings()

engine = create_engine(
    url=settings.database_url,
    pool_pre_ping=True,  # TODO: make anki out of this part
)

local_db_session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def load_orm_models() -> None:
    import backend.app.db.orm.card_progress as card_progress
    import backend.app.db.orm.deck as deck
    import backend.app.db.orm.flashcard as flashcard
    import backend.app.db.orm.flashcard_settings as flashcard_settings

    _ = (card_progress, deck, flashcard, flashcard_settings)


def initialize_db_schemas():
    """Make sure all db tables exist."""
    load_orm_models()
    Base.metadata.create_all(engine)


def get_db() -> Generator[Session, None, None]:
    """Per-request database session management."""
    db = local_db_session()
    try:
        yield db
    finally:
        db.close()
