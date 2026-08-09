from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.anki_import import AnkiImportRequest, AnkiImportResponse
from backend.app.schemas.card_progress import (
    CardProgressRead,
    RestoreProgressRequest,
    ReviewRequest,
    ReviewResponse,
)
from backend.app.schemas.deck import DeckContent, DeckCreate, DeckStats
from backend.app.schemas.deck_update import DeckRename, DeckTrackUpdate
from backend.app.schemas.flashcard import FlashcardContent, FlashcardCreate
from backend.app.schemas.flashcard_settings import FlashcardSettingsContent, FlashcardSettingsUpdate
from backend.app.schemas.flashcard_update import FlashcardUpdate
from backend.app.schemas.stats import StatsOverview
from backend.app.services.flashcards.anki_import import import_anki_cards
from backend.app.services.flashcards.card_manager import CardManager
from backend.app.services.flashcards.card_settings import get_flashcards_settings, update_flashcard_settings
from backend.app.services.flashcards.deck_manager import DeckManager
from backend.app.services.flashcards.review import CardReviewer
from backend.app.services.flashcards.stats import get_stats_overview

router = APIRouter(tags=["decks"])


@router.get("/flashcard-settings", response_model=FlashcardSettingsContent)
async def get_flashcards_settings_route(
    db: Annotated[Session, Depends(get_db)],
) -> FlashcardSettingsContent:
    settings_orm = get_flashcards_settings(db)
    settings = FlashcardSettingsContent.from_orm(settings_orm)
    return settings


@router.patch("/flashcard-settings", response_model=FlashcardSettingsContent)
async def patch_flashcard_settings(
    payload: FlashcardSettingsUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> FlashcardSettingsContent:
    settings_orm = update_flashcard_settings(db, payload)
    settings = FlashcardSettingsContent.from_orm(settings_orm)
    return settings


@router.get("/stats", response_model=StatsOverview)
async def get_stats(
    db: Annotated[Session, Depends(get_db)],
) -> StatsOverview:
    return get_stats_overview(db)


@router.post("/import/anki", response_model=AnkiImportResponse)
async def post_anki_import(
    payload: AnkiImportRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AnkiImportResponse:
    return import_anki_cards(db, payload)


@router.get("/decks", response_model=list[DeckContent])
async def get_decks(
    db: Annotated[Session, Depends(get_db)],
    track: Annotated[str | None, Query()] = None,
) -> list[DeckContent]:
    deck_manager = DeckManager(db)
    decks_orm = deck_manager.list_decks(track)
    decks = DeckContent.from_list_orm(decks_orm)
    return decks


@router.post("/decks", response_model=DeckContent, status_code=status.HTTP_201_CREATED)
async def post_deck(
    payload: DeckCreate,
    db: Annotated[Session, Depends(get_db)],
) -> DeckContent:
    deck_manager = DeckManager(db)
    deck_orm = deck_manager.create_deck(payload)
    deck = DeckContent.from_orm(deck_orm)
    return deck


@router.patch("/decks/{deck_id}", response_model=DeckContent)
async def patch_deck(
    deck_id: int,
    payload: DeckRename,
    db: Annotated[Session, Depends(get_db)],
) -> DeckContent:
    deck_manager = DeckManager(db)
    deck_orm = deck_manager.rename_deck(payload.title, deck_id)
    deck = DeckContent.from_orm(deck_orm)
    return deck


@router.patch("/decks/{deck_id}/track", response_model=DeckContent)
async def patch_deck_track(
    deck_id: int,
    payload: DeckTrackUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> DeckContent:
    deck_manager = DeckManager(db)
    deck_orm = deck_manager.update_deck_track(payload.track, deck_id)
    deck = DeckContent.from_orm(deck_orm)
    return deck


@router.delete("/decks/{deck_id}")
async def delete_deck_by_id(
    deck_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, bool]:
    deck_manager = DeckManager(db)
    deleted = deck_manager.delete_deck(deck_id)
    return {"deleted": deleted}


@router.get("/decks/{deck_id}", response_model=DeckContent)
async def get_deck_by_id(
    deck_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> DeckContent:
    deck_manager = DeckManager(db)
    deck_orm = deck_manager.get_deck(deck_id)
    deck = DeckContent.from_orm(deck_orm)
    return deck


@router.get("/decks/{deck_id}/stats", response_model=DeckStats)
async def get_deck_stats_by_id(
    deck_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> DeckStats:
    deck_manager = DeckManager(db)
    deck_stats = deck_manager.get_deck_stats(deck_id)
    return deck_stats


@router.get("/decks/{deck_id}/cards", response_model=list[FlashcardContent])
async def get_deck_cards(
    deck_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> list[FlashcardContent]:
    deck_manager = DeckManager(db)
    list_cards_orm = deck_manager.list_flashcards(deck_id)
    list_cards = FlashcardContent.from_list_orm(list_cards_orm)
    return list_cards


@router.post("/decks/{deck_id}/cards", response_model=FlashcardContent, status_code=status.HTTP_201_CREATED)
async def post_deck_card(
    deck_id: int,
    payload: FlashcardCreate,
    db: Annotated[Session, Depends(get_db)],
) -> FlashcardContent:
    card_manager = CardManager(db)
    card_orm = card_manager.create_flashcard(deck_id, payload)
    card = FlashcardContent.from_orm(card_orm)
    return card


@router.get("/decks/{deck_id}/due")
async def get_deck_due_cards(
    deck_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    deck_manager = DeckManager(db)
    due_cards = deck_manager.get_due_cards(deck_id)
    return due_cards


@router.get("/cards/{card_id}/progress", response_model=CardProgressRead | None)
async def get_card_progress_by_id(
    card_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> CardProgressRead:
    card_manager = CardManager(db)
    card_orm = card_manager.get_card_progress(card_id)
    card = CardProgressRead.from_orm(card_orm)
    return card


@router.post("/cards/{card_id}/review", response_model=ReviewResponse)
async def post_card_review(
    card_id: int,
    review_input: ReviewRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ReviewResponse:

    reviewer = CardReviewer(db)
    progress_orm, previous_progress_orm, next_interval = reviewer.review(card_id, review_input.rating)

    progress = CardProgressRead.from_orm(progress_orm)
    previous_progress = CardProgressRead.from_orm(previous_progress_orm) if previous_progress_orm else None

    return ReviewResponse(progress=progress, previousProgress=previous_progress, nextInterval=next_interval)


@router.post("/cards/{card_id}/restore-progress")
async def post_restore_progress(
    card_id: int,
    payload: RestoreProgressRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, CardProgressRead | None]:
    card_manager = CardManager(db)
    restored_orm = card_manager.restore_card_progress(card_id, payload.progress)
    restored = CardProgressRead.from_orm(restored_orm) if restored_orm else None
    return {"progress": restored}


@router.patch("/cards/{card_id}", response_model=FlashcardContent)
async def patch_card(
    card_id: int,
    payload: FlashcardUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> FlashcardContent:
    card_manager = CardManager(db)
    card_orm = card_manager.update_flashcard(card_id, payload)
    card = FlashcardContent.from_orm(card_orm)
    return card


@router.delete("/cards/{card_id}")
async def delete_card(
    card_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    card_manager = CardManager(db)
    is_deleted = card_manager.delete_flashcard(card_id)
    return {"deleted": is_deleted, "card": card_id}


@router.get("/cards/{card_id}/preview-intervals")
async def get_card_preview_intervals(
    card_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> dict[int, str]:
    reviewer = CardReviewer(db)
    return reviewer.show_ratings_preview(card_id)
