import pytest

from backend.app.db.orm.card_progress import CardProgressORM
from backend.app.schemas.anki_import import AnkiImportRequest
from backend.app.schemas.flashcard_settings import FlashcardSettingsContent
from backend.app.services.flashcards.anki_import import parse_anki_content
from backend.app.services.flashcards.learning import LearningStepsProgress
from backend.app.services.flashcards.review import CardReviewer
from backend.app.services.flashcards.scheduler import LearningScheduler, ReviewScheduler, SchedulerResult
from backend.app.services.flashcards.types import Rating, ReviewerCardProgress, State

default_pytest_card_settings = FlashcardSettingsContent(
    id=1,
    newCardsPerDay=1,
    learningSteps="10m 1h 3d",
    relearningSteps="10m",
    minimumInterval=1,
    easyReviewInterval=9,
    normalReviewInterval=7,
)


def test_parse_anki_content() -> None:
    """Correct parsing for a request."""
    payload = AnkiImportRequest(
        deck_id=1,
        content="",
        separator="\t",
    )

    card = parse_anki_content("  <b>Front</b>\tBack &amp; More\ttag1 tag2  ", payload)

    assert card.deck_id == 1
    assert card.front == "Front"
    assert card.back == "Back & More"
    assert card.code_example is None
    assert card.difficulty == "medium"
    assert card.tags == '["tag1", "tag2"]'


def test_parse_anki_content_raises_for_missing_fields() -> None:
    payload = AnkiImportRequest(deck_id=1, content="", separator="\t")

    with pytest.raises(ValueError, match="Not enough fields"):
        parse_anki_content("front only", payload)


def test_parse_anki_content_raises_for_empty_front_or_back() -> None:
    payload = AnkiImportRequest(deck_id=1, content="", separator="\t")

    with pytest.raises(ValueError, match="Empty front or back"):
        parse_anki_content("\tback", payload)


def test_graduation_card():
    """Learning scheduler: GOOD on the last learning step graduates the card to REVIEW."""
    card_to_graduate = ReviewerCardProgress(
        state=State.LEARN,
        step_index=2,  # last step
        interval=5,
        easy_multiplier=1.3,
        repetitions=0,
        failures_while_review=1,
    )

    steps_of_card_to_graduate = LearningStepsProgress(
        state=State.LEARN,
        settings=default_pytest_card_settings,
        card_progress=card_to_graduate,
    )

    learning_scheduler = LearningScheduler(card_to_graduate, default_pytest_card_settings)
    result = learning_scheduler.apply_rating(Rating.GOOD, card_to_graduate.state, steps_of_card_to_graduate)

    assert result.state == State.REVIEW


def test_review_scheduler_blackout():
    """Review scheduler: BLACKOUT moves a REVIEW card back to RELEARN."""
    card_in_review_to_relearn = ReviewerCardProgress(
        state=State.REVIEW,
        step_index=0,
        interval=5,
        easy_multiplier=1.3,
        repetitions=0,
        failures_while_review=1,
    )

    steps_of_card_to_relearn = LearningStepsProgress(
        state=State.RELEARN,
        settings=default_pytest_card_settings,
        card_progress=card_in_review_to_relearn,
    )

    review_scheduler = ReviewScheduler(card_in_review_to_relearn, default_pytest_card_settings)
    current_failures_while_review = card_in_review_to_relearn.failures_while_review
    result = review_scheduler.apply_rating(Rating.BLACKOUT, steps_of_card_to_relearn)

    assert result.state == State.RELEARN
    assert result.failures_while_review == current_failures_while_review + 1


def test_reviewer_preserve_progress() -> None:
    """CardReviewer.update_progress() preserves first_reviewed_at for an existing card."""
    existing_card = CardProgressORM(
        card_id=1,
        stored_review_interval=5,
        easy_multiplier=2.5,
        repetitions=3,
        show_again_at=123456,
        first_reviewed_at=111111,
        state=State.REVIEW.value,
        step_index=None,
        failures_while_review=1,
        last_rating=Rating.GOOD.value,
    )

    scheduled = SchedulerResult(
        state=State.RELEARN,
        step_index=0,
        stored_review_interval=1,
        easy_multiplier=2.3,
        repetitions=2,
        failures_while_review=2,
        show_again_at=222222,
        preview="10 mins",
    )

    updated = CardReviewer.update_progress(
        progress_orm=existing_card,
        scheduled=scheduled,
        existing=existing_card,
        rating=Rating.BLACKOUT,
    )

    assert updated.state == scheduled.state.value
    assert updated.step_index == scheduled.step_index
    assert updated.stored_review_interval == scheduled.stored_review_interval
    assert updated.easy_multiplier == scheduled.easy_multiplier
    assert updated.repetitions == scheduled.repetitions
    assert updated.show_again_at == scheduled.show_again_at
    assert updated.failures_while_review == scheduled.failures_while_review
    assert updated.last_rating == Rating.BLACKOUT.value
    assert updated.first_reviewed_at == existing_card.first_reviewed_at


def test_reviewer_snapshot() -> None:
    """CardReviewer.snapshot_progress() returns a copy, not the same object."""
    existing_card = CardProgressORM(
        card_id=1,
        stored_review_interval=5,
        easy_multiplier=2.5,
        repetitions=3,
        show_again_at=123456,
        first_reviewed_at=111111,
        state=State.REVIEW.value,
        step_index=None,
        failures_while_review=1,
        last_rating=Rating.GOOD.value,
    )

    snapshot = CardReviewer.snapshot_progress(existing_card)
    existing_card_values = existing_card.__dict__
    snapshot_values = snapshot.__dict__

    assert existing_card is not snapshot
    assert existing_card_values != snapshot_values
