from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class FlashcardSettingsORM(Base):
    __tablename__ = "flashcard_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    new_cards_per_day: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    learning_steps: Mapped[str] = mapped_column(Text, default="10m 1d 3d", nullable=False)
    normal_review_interval: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    easy_review_interval: Mapped[int] = mapped_column(Integer, default=9, nullable=False)
    relearning_steps: Mapped[str] = mapped_column(Text, default="10m", nullable=False)
    minimum_interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
