import logging
from dataclasses import dataclass

from backend.app.schemas.flashcard_settings import FlashcardSettingsContent
from backend.app.services.flashcards.defaults import defaults
from backend.app.services.flashcards.learning import LearningStepsProgress
from backend.app.services.flashcards.types import Rating, ReviewerCardProgress, State
from backend.app.services.utils import TimeUnits, abs_timestamp_ms, display_time, in_between

logger = logging.getLogger(__name__)


@dataclass
class SchedulerResult:
    state: State
    step_index: int | None
    stored_review_interval: int
    easy_multiplier: float
    repetitions: int
    failures_while_review: int
    show_again_at: int  # the absolute timestamp when the card should appear again (milliseconds)
    preview: str


def update_easy_multiplier(card_progress: ReviewerCardProgress, rating: Rating):
    rating_adjustment = {
        Rating.BLACKOUT: -0.2,
        Rating.HARD: -0.15,
        Rating.GOOD: 0,
        Rating.EASY: 0.15,
    }

    next_value = card_progress.easy_multiplier + rating_adjustment[rating]
    return max(defaults.min_easy_multiplier, next_value)


class LearningScheduler:
    """The Learning scheduler plans the next due review for the cards that are in the state NEW, LEARN, or RELEARN."""

    def __init__(
        self,
        card_progress: ReviewerCardProgress,
        settings: FlashcardSettingsContent,
    ):
        self.settings = settings
        self.card_progress = card_progress
        self.stored_interval = self.card_progress.interval

    def get_interval(self, state: State):
        """What scheduling interval should be treated as the current review interval?
        It depends on whether the card is in the (re-)learning state or in the review state."""

        # In the Relearn State the card already had an interval
        if state == State.RELEARN:
            card_interval = self.card_progress.interval
        # while if it graduates for the first time from learn to review, it doesn't
        else:
            card_interval = self.settings.normal_review_interval

        card_interval = max(self.settings.minimum_interval, card_interval)
        return card_interval

    def schedule_blackout(self, state: State, steps: LearningStepsProgress) -> SchedulerResult:
        next_show_up = steps.first_step  # Since the user has failed to recall the card at all
        logger.info(f"Scheduling Blackout for {steps} steps. Next step: {next_show_up}")

        return SchedulerResult(
            state=state,
            step_index=steps.FIRST_STEP_INDEX,
            stored_review_interval=self.stored_interval,
            easy_multiplier=self.card_progress.easy_multiplier,
            repetitions=self.card_progress.reset_repetitions,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(next_show_up),
            preview=display_time(next_show_up),
        )

    def schedule_hard(self, state: State, previous_step, current_step, next_step) -> SchedulerResult:
        is_last_step = next_step is None
        next_show_up = in_between(previous_step, current_step) if is_last_step else in_between(current_step, next_step)
        logger.info(f"Scheduling Hard for {next_step} steps. Next step: {next_show_up}")

        return SchedulerResult(
            state=state,
            step_index=self.card_progress.step_index,
            stored_review_interval=self.stored_interval,
            easy_multiplier=self.card_progress.easy_multiplier,
            repetitions=self.card_progress.repetitions,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(next_show_up),
            preview=display_time(next_show_up),
        )

    def schedule_good(self, state: State, next_step: int | None) -> SchedulerResult:
        is_last_step = next_step is None
        if is_last_step:
            logger.info(f"Graduating to Review since the learning steps are exhausted. Next step: {next_step}")
            graduating_interval = self.get_interval(state)
            graduating_interval_minutes = TimeUnits("d").to_minutes(graduating_interval)
            logger.info(f"Scheduling Good for {graduating_interval} minutes. Next show up: {graduating_interval_minutes}")

            return SchedulerResult(
                state=State.REVIEW,
                step_index=None,  # Learning steps is irrelevant in review state
                stored_review_interval=graduating_interval,
                easy_multiplier=self.card_progress.easy_multiplier,
                repetitions=self.card_progress.repetitions_after_success,
                failures_while_review=self.card_progress.failures_while_review,
                show_again_at=abs_timestamp_ms(graduating_interval_minutes),
                preview=display_time(graduating_interval_minutes),
            )

        else:
            logger.info(f"Scheduling Good for {next_step} steps. Next step: {next_step}")
            next_review = next_step

            return SchedulerResult(
                state=state,
                step_index=self.card_progress.next_index,
                stored_review_interval=self.stored_interval,
                easy_multiplier=self.card_progress.easy_multiplier,
                repetitions=self.card_progress.repetitions,
                failures_while_review=self.card_progress.failures_while_review,
                show_again_at=abs_timestamp_ms(next_review),
                preview=display_time(next_review),
            )

    def schedule_easy(self, state: State) -> SchedulerResult:
        if state == state.RELEARN:
            review_interval = self.settings.normal_review_interval
        elif state in [state.LEARN, state.NEW]:
            review_interval = round(self.settings.easy_review_interval * self.card_progress.easy_multiplier)
        else:
            raise ValueError(f"Not valid state ({state}) for learning scheduling. Only NEW, LEARN, RELEARN are valid.")

        review_interval_minutes = TimeUnits("d").to_minutes(review_interval)
        logger.info(f"Scheduling Easy for {review_interval}")

        return SchedulerResult(
            state=State.REVIEW,
            step_index=None,
            stored_review_interval=review_interval,
            easy_multiplier=update_easy_multiplier(self.card_progress, Rating.EASY),
            repetitions=self.card_progress.repetitions_after_success,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(review_interval_minutes),
            preview=display_time(review_interval_minutes),
        )

    def apply_rating(self, rating: Rating, state: State, learning_steps: LearningStepsProgress) -> SchedulerResult:
        previous_step = learning_steps.previous_step
        current_step = learning_steps.current_step
        next_step = learning_steps.next_step

        if rating == Rating.BLACKOUT:
            scheduler_result = self.schedule_blackout(state, learning_steps)
        elif rating == Rating.HARD:
            scheduler_result = self.schedule_hard(state, previous_step, current_step, next_step)
        elif rating == Rating.GOOD:
            scheduler_result = self.schedule_good(state, next_step)
        elif rating == Rating.EASY:
            scheduler_result = self.schedule_easy(state)
        else:
            raise ValueError(f"Invalid rating: {rating}")

        return scheduler_result

    def plan_next_review(
        self,
        rating: Rating,
    ) -> SchedulerResult:

        state = self.card_progress.state
        learning_steps = LearningStepsProgress(state, self.settings, self.card_progress)
        scheduled_card = self.apply_rating(rating, state, learning_steps)
        logger.info(f"Next review for {rating}: {scheduled_card}")

        return scheduled_card

    def get_preview(self, rating: Rating) -> str:
        scheduled_card = self.plan_next_review(rating)
        preview = scheduled_card.preview
        logger.info(f"Preview for {rating}: {preview}")

        return preview


class ReviewScheduler:
    """The Review scheduler plans the next due review for the cards that are in the state REVIEW."""

    def __init__(self, card_progress: ReviewerCardProgress, settings: FlashcardSettingsContent):
        self.card_progress = card_progress
        self.settings = settings
        self.current_easy_multiplier = self.card_progress.easy_multiplier
        self.current_repetitions = self.card_progress.repetitions
        self.current_failures = self.card_progress.failures_while_review

    def guarantee_review_state(self) -> State:
        if self.card_progress.state == State.REVIEW:
            logger.info(f"Review state guaranteed for {self.card_progress.state}")
            return self.card_progress.state
        else:
            raise ValueError(f"Invalid state `{self.card_progress.state}` for review scheduling. Should be 'review'.")

    def shrink_interval(self, rate: Rating) -> int:
        rating_adjustment = {
            Rating.BLACKOUT: 0.2,
            Rating.HARD: 0.5,
        }
        interval = self.card_progress.interval
        updated_interval = round(interval * rating_adjustment[rate])
        logger.info(f"Updating interval for {self.card_progress.state} with {updated_interval}")
        return max(self.settings.minimum_interval, updated_interval)

    def increase_interval(self, rate: Rating) -> int:
        updated_interval = round(self.card_progress.interval * update_easy_multiplier(self.card_progress, rate))
        # logger.info()
        return max(self.settings.minimum_interval, updated_interval)

    def schedule_blackout(self, steps: LearningStepsProgress) -> SchedulerResult:
        logger.info(f"Scheduling blackout for {self.card_progress.state}")
        first_relearn_step = steps.first_step  # Since the user has failed to recall the card at all

        return SchedulerResult(
            state=State.RELEARN,
            step_index=steps.FIRST_STEP_INDEX,
            stored_review_interval=self.shrink_interval(Rating.BLACKOUT),
            easy_multiplier=update_easy_multiplier(self.card_progress, Rating.BLACKOUT),
            repetitions=self.card_progress.repetitions_after_failure,
            failures_while_review=self.card_progress.review_failures_after_failure,
            show_again_at=abs_timestamp_ms(first_relearn_step),
            preview=display_time(first_relearn_step),
        )

    def schedule_hard(self):
        logger.info(f"Scheduling hard for {self.card_progress.state}")
        interval = self.shrink_interval(Rating.HARD)

        return SchedulerResult(
            state=State.REVIEW,
            step_index=None,
            stored_review_interval=interval,
            easy_multiplier=update_easy_multiplier(self.card_progress, Rating.HARD),
            repetitions=self.card_progress.repetitions_after_success,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(interval),
            preview=display_time(interval),
        )

    def schedule_good(self):
        logger.info(f"Scheduling good for {self.card_progress.state}")
        interval = self.increase_interval(Rating.GOOD)

        return SchedulerResult(
            state=State.REVIEW,
            step_index=None,
            stored_review_interval=interval,
            easy_multiplier=update_easy_multiplier(self.card_progress, Rating.GOOD),
            repetitions=self.card_progress.repetitions_after_success,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(interval),
            preview=display_time(interval),
        )

    def schedule_easy(self):
        logger.info(f"Scheduling easy for {self.card_progress.state}")
        interval = self.increase_interval(Rating.EASY)

        return SchedulerResult(
            state=State.REVIEW,
            step_index=None,
            stored_review_interval=interval,
            easy_multiplier=update_easy_multiplier(self.card_progress, Rating.EASY),
            repetitions=self.card_progress.repetitions_after_success,
            failures_while_review=self.card_progress.failures_while_review,
            show_again_at=abs_timestamp_ms(interval),
            preview=display_time(interval),
        )

    def apply_rating(self, rating: Rating, steps: LearningStepsProgress) -> SchedulerResult:

        if rating == Rating.BLACKOUT:
            scheduler_result = self.schedule_blackout(steps)
        elif rating == Rating.HARD:
            scheduler_result = self.schedule_hard()
        elif rating == Rating.GOOD:
            scheduler_result = self.schedule_good()
        elif rating == Rating.EASY:
            scheduler_result = self.schedule_easy()
        else:
            raise ValueError(f"Invalid rating: {rating}")

        return scheduler_result

    def plan_next_review(self, rating: Rating) -> SchedulerResult:

        state = self.guarantee_review_state()
        relearning_steps = LearningStepsProgress(state, self.settings, self.card_progress)
        scheduled_card = self.apply_rating(rating, relearning_steps)
        logger.info(f"Next review for {rating}: {scheduled_card}")
        return scheduled_card

    def get_preview(self, rating: Rating) -> str:
        scheduled_card = self.plan_next_review(rating)
        preview = scheduled_card.preview
        logger.info(f"Preview for {rating}: {preview}")
        return preview


class CardScheduler:
    """The scheduler decides how to schedule a card based on the user's rating and the card's current progress."""

    def __init__(
        self,
        card_progress: ReviewerCardProgress,
        settings: FlashcardSettingsContent,
    ):
        self.settings = settings
        self.card_progress = card_progress

    def assign_scheduler(self) -> LearningScheduler | ReviewScheduler:
        state = self.card_progress.state

        if state in {State.LEARN, State.RELEARN, State.NEW}:
            scheduler = LearningScheduler(self.card_progress, self.settings)
        elif state == State.REVIEW:
            scheduler = ReviewScheduler(self.card_progress, self.settings)
        else:
            raise ValueError(f"Invalid state: {state}")

        logger.info(f"Assigning scheduler for {state}")
        return scheduler

    def schedule(self, rating: Rating) -> SchedulerResult:
        scheduler = self.assign_scheduler()
        return scheduler.plan_next_review(rating)

    def show_previews(self) -> dict[int, str]:
        scheduler = self.assign_scheduler()
        previews = {}
        for rate in Rating:
            rating_preview = scheduler.get_preview(rate)
            previews[rate.value] = rating_preview
            logger.info(f"Preview for {rate}: {previews[rate.value]}")

        return previews
