from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class ClusterSession(Base):
    __tablename__ = "cluster_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    cluster_server_id: Mapped[int] = mapped_column(Integer, nullable=False)
    namespace: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="provisioning")
    kubeconfig_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    kubeconfig_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    node_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
