from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class TerminalExercise(Base):
    __tablename__ = "terminal_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    track: Mapped[str] = mapped_column(String, nullable=False)
    difficulty: Mapped[str] = mapped_column(String, default="medium", nullable=False)
    scenario: Mapped[str] = mapped_column(Text, nullable=False)
    objectives: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    valid_commands: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    ambient_commands: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    world_state: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    initial_output: Mapped[str] = mapped_column(Text, default="", nullable=False)
    completion_message: Mapped[str] = mapped_column(Text, default="Exercise complete!", nullable=False)
