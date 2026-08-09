class CardProgressDefaults:
    state: str = "new"
    step_index: int = 0
    interval: int = 0
    show_again_at: int = 0
    min_easy_multiplier: float = 1.3  # Arbitrary minimum multiplier to prevent cards from becoming unrecoverable
    easy_multiplier: float = 2.5
    repetitions: int = 0
    failures_while_review: int = 0


defaults = CardProgressDefaults()
