from sqlalchemy import BigInteger, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class CardProgressORM(Base):
    __tablename__ = "card_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    stored_review_interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    easy_multiplier: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    repetitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    show_again_at: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    first_reviewed_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    state: Mapped[str] = mapped_column(String, default="review", nullable=False)
    step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failures_while_review: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
