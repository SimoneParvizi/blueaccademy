from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class CkadExercise(Base):
    __tablename__ = "ckad_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    mode: Mapped[str] = mapped_column(String, default="ckad", nullable=False)
    track: Mapped[str] = mapped_column(String, default="kubernetes", nullable=False)
    domain: Mapped[str] = mapped_column(String, nullable=False)
    difficulty: Mapped[str] = mapped_column(String, default="medium", nullable=False)
    time_minutes: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    scenario: Mapped[str] = mapped_column(Text, nullable=False)
    hints: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    solution: Mapped[str] = mapped_column(Text, nullable=False)
    validations: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    cleanup: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
