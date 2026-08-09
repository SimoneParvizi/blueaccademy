from sqlalchemy import Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class ExerciseProgress(Base):
    __tablename__ = "exercise_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exercise_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    completed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
