from __future__ import annotations

import os
import subprocess
import tempfile
from time import time

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.app.db.orm.kubeconfig import Kubeconfig
from backend.app.schemas.kubeconfig import KubeconfigCreate


class KubeconfigValidationError(ValueError):
    def __init__(self, message: str, detail: str) -> None:
        super().__init__(message)
        self.detail = detail


def list_kubeconfigs(db: Session) -> list[Kubeconfig]:
    return list(db.scalars(select(Kubeconfig).order_by(Kubeconfig.created_at.asc())).all())


def get_active_kubeconfig(db: Session) -> Kubeconfig | None:
    return db.scalar(select(Kubeconfig).where(Kubeconfig.active.is_(True)))


def validate_kubeconfig_content(content: str) -> None:
    fd, tmp_path = tempfile.mkstemp(prefix="kube-validate-", suffix=".yaml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        result = subprocess.run(
            ["kubectl", "--kubeconfig", tmp_path, "cluster-info"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as exc:  # pragma: no cover - exercised via route stubs/tests
        raise KubeconfigValidationError("Kubeconfig validation error", str(exc)) from exc
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass

    if result.returncode != 0:
        raise KubeconfigValidationError(
            "Kubeconfig validation failed",
            result.stderr or result.stdout or "Could not connect to cluster",
        )


def create_kubeconfig(db: Session, payload: KubeconfigCreate) -> Kubeconfig:
    validate_kubeconfig_content(payload.content)
    should_activate = payload.active if payload.active is not None else True
    if should_activate:
        db.execute(update(Kubeconfig).values(active=False))
    kubeconfig = Kubeconfig(
        name=payload.name,
        content=payload.content,
        active=should_activate,
        created_at=round(time() * 1000),
    )
    db.add(kubeconfig)
    db.commit()
    db.refresh(kubeconfig)
    return kubeconfig


def activate_kubeconfig(db: Session, kubeconfig_id: int) -> bool:
    kubeconfig = db.get(Kubeconfig, kubeconfig_id)
    if kubeconfig is None:
        return False
    db.execute(update(Kubeconfig).values(active=False))
    kubeconfig.active = True
    db.commit()
    return True


def delete_kubeconfig(db: Session, kubeconfig_id: int) -> bool:
    kubeconfig = db.get(Kubeconfig, kubeconfig_id)
    if kubeconfig is None:
        return False
    db.delete(kubeconfig)
    db.commit()
    return True
