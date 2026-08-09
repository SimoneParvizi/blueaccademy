from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.orm.base import Base


class ClusterServer(Base):
    __tablename__ = "cluster_servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    hetzner_token: Mapped[str] = mapped_column(Text, nullable=False)
    server_id: Mapped[str | None] = mapped_column(String, nullable=True)
    server_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    ssh_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    ssh_key_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="provisioning")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    server_type: Mapped[str] = mapped_column(String, nullable=False, default="cx23")
    location: Mapped[str] = mapped_column(String, nullable=False, default="nbg1")
    kubeconfig_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    miniblue_port: Mapped[int] = mapped_column(Integer, nullable=False, default=4566)
    idle_started_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
