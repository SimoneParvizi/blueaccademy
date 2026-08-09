import json
import logging
import re

from sqlalchemy.orm import Session

from backend.app.schemas.anki_import import AnkiImportRequest, AnkiImportResponse
from backend.app.schemas.flashcard import FlashcardContent
from backend.app.services.flashcards.card_manager import CardManager

logger = logging.getLogger(__name__)


def clean_anki_html(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", value)
    return cleaned.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def parse_anki_content(line: str, payload: AnkiImportRequest) -> FlashcardContent:
    separator = payload.separator
    parts = [part.strip() for part in line.split(separator)]
    if len(parts) < 2:
        raise ValueError("Not enough fields")

    front, back = parts[0], parts[1]
    raw_tags = parts[2] if len(parts) > 2 else "[]"

    if not front or not back:
        raise ValueError("Empty front or back")

    card = FlashcardContent.model_validate(
        {
            "deck_id": payload.deck_id,
            "front": clean_anki_html(front),
            "back": clean_anki_html(back),
            "code_example": None,
            "difficulty": "medium",
            "tags": normalize_tags(raw_tags),
        }
    )
    logger.info(f"Flashcard content: {card}")
    return card


def normalize_tags(raw_tags: str) -> str:
    if raw_tags.startswith("["):
        return raw_tags

    tags = [tag for tag in raw_tags.split(" ") if tag]
    return json.dumps(tags)


# TODO: do unit test for this
def import_anki_cards(db: Session, payload: AnkiImportRequest) -> AnkiImportResponse:
    imported_ids = []
    errors = []

    card_manager = CardManager(db)
    for index, line in enumerate(payload.lines, start=1):
        try:
            content = parse_anki_content(line, payload)
            card = card_manager.create_flashcard(payload.deck_id, content)
            if card and card.id:
                logger.info(f"Flashcard imported: {card.id}")
                imported_ids.append(card.id)
        except Exception as exc:
            logger.error(f"Flashcard importing failed: {exc}")
            errors.append(f"Line {index}: {exc}")

    return AnkiImportResponse(imported=len(imported_ids), errors=len(errors), errorDetails=errors[:30])
