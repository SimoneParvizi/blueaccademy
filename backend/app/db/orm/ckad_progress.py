from sqlalchemy import Boolean, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class CkadProgress(Base):
    __tablename__ = "ckad_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exercise_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_attempt_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_result: Mapped[str | None] = mapped_column(Text, nullable=True)
