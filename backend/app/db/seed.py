from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.orm.deck import DeckORM
from backend.app.db.orm.flashcard import FlashcardORM
from backend.app.db.orm.flashcard_settings import FlashcardSettingsORM
from backend.app.db.session import initialize_db_schemas, local_db_session
from backend.app.logging import configure_logging

logger = logging.getLogger(__name__)


db_root = Path(__file__).resolve().parents[0]
seed_dir = db_root / "learning_content"


K8S_DECK_BY_TAG_GROUP = {
    "k8s_networking": {
        "services",
        "networking",
        "ingress",
        "networkpolicy",
        "dns",
        "cni",
        "headless",
        "endpoints",
        "kube-proxy",
        "annotations",
        "metadata",
    },
    "k8s_storage": {
        "configmaps",
        "secrets",
        "pv",
        "pvc",
        "storageclasses",
        "rbac",
        "serviceaccounts",
        "security",
        "pss",
        "admission",
        "storage",
        "persistenvolumes",
        "resources",
        "internals",
    },
    "k8s_ops": {
        "hpa",
        "vpa",
        "scheduling",
        "crds",
        "etcd",
        "scheduler",
        "preemption",
        "autoscaler",
        "garbage",
        "batch",
        "deployments",
        "rollout",
        "monitoring",
        "operations",
        "autoscaling",
        "cluster-autoscaler",
    },
    "k8s_basics": {
        "pods",
        "debugging",
        "operators",
        "helm",
        "apiserver",
        "kubelet",
        "fundamentals",
        "jobs",
        "updates",
        "kubectl",
        "controller-manager",
        "control-plane",
    },
}

DOCKER_DECK_BY_TAG_GROUP = {
    "docker_security": {
        "security",
        "rootless",
        "capabilities",
        "scanning",
        "signing",
        "registry",
        "tagging",
        "seccomp",
        "apparmor",
        "debugging",
        "inspect",
        "docker-cli",
    },
    "docker_runtime": {
        "compose",
        "volumes",
        "networks",
        "runtime",
        "exec",
        "logs",
        "stats",
        "prune",
        "healthcheck",
        "resource-limits",
        "logging",
        "networking",
        "bridge",
        "host",
        "resources",
        "limits",
        "operations",
        "performance",
        "storage-driver",
        "pid",
        "internals",
    },
    "docker_build": {
        "build",
        "dockerfile",
        "layers",
        "images",
        "fundamentals",
        "optimization",
        "multi-stage",
        "go",
        "scratch",
    },
}

PULUMI_DECK_BY_TAG_GROUP = {
    "pulumi_advanced": {
        "component",
        "automation",
        "testing",
        "crossguard",
        "policy",
        "stack-reference",
        "esc",
        "dynamic",
        "transforms",
        "integration",
        "resource-options",
        "protect",
        "safety",
        "automation-api",
        "cicd",
        "providers",
        "multi-account",
        "multi-region",
        "dynamic-providers",
        "security",
        "rbac",
        "pulumi-cloud",
    },
    "pulumi_core": {
        "stack",
        "preview",
        "up",
        "projects",
        "fundamentals",
        "cli",
        "destroy",
        "config",
        "stacks",
        "outputs",
        "interpolate",
        "strings",
        "components",
        "abstraction",
        "yaml",
        "typescript",
        "languages",
        "import",
        "state",
        "migration",
        "best-practices",
        "architecture",
        "debugging",
        "operations",
        "troubleshooting",
        "blue-green",
        "deployment",
        "aliases",
        "patterns",
    },
}

MAPPING_DECK_NAME_TAG = {
    "k8s_cards": K8S_DECK_BY_TAG_GROUP,
    "docker_cards": DOCKER_DECK_BY_TAG_GROUP,
    "pulumi_cards": PULUMI_DECK_BY_TAG_GROUP,
}


def load_json(name: str) -> dict:
    with (seed_dir / name).open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        raise ValueError(f"{name}.json must contain an object payload")

    return payload


def build_flashcard_seed(deck_orm: DeckORM, card_payload: dict) -> FlashcardORM:
    flashcard_data = {
        "deck_id": deck_orm.id,
        "front": card_payload["front"],
        "back": card_payload["back"],
        "code_example": card_payload["code_example"],
        "difficulty": card_payload["difficulty"],
        "tags": card_payload["tags"],
    }
    orm = FlashcardORM(**flashcard_data)
    return orm


def seed_decks(db: Session, decks_dict) -> dict[str, DeckORM]:
    deck_records: dict[str, DeckORM] = {}
    for deck_title, content in decks_dict.items():
        deck = DeckORM(**content)
        db.add(deck)
        deck_records[deck_title] = deck

    db.flush()
    return deck_records


def seed_cards(db: Session, cards_payload: dict, deck_records: dict[str, DeckORM]) -> dict[str, int]:
    card_count_by_deck = {key: 0 for key in deck_records}

    for card_group, mapping in MAPPING_DECK_NAME_TAG.items():
        for card in cards_payload[card_group]:
            deck_name = pick_deck_key(card["tags"], mapping)
            target_deck = deck_records[deck_name]
            flashcard_orm = build_flashcard_seed(target_deck, card)

            db.add(flashcard_orm)
            card_count_by_deck[deck_name] += 1

    return card_count_by_deck


def normalize_tags(tags: object) -> list[str]:
    if not isinstance(tags, list):
        raise TypeError("tags must be a list of strings")
    if not all(isinstance(tag, str) for tag in tags):
        raise TypeError("tags must be a list of strings")
    return cast(list[str], tags)


def pick_deck_key(tags: list[str], tag_group: dict) -> str:
    normalized_tags = normalize_tags(tags)
    for theme, expected_tags in tag_group.items():
        if any(tag in expected_tags for tag in normalized_tags):
            return theme
    raise ValueError(f"Seed wasn't completed: no matching deck for tags {normalized_tags} in {tag_group.keys()}")


def has_decks(db: Session) -> bool:
    deck_count = db.scalar(select(func.count()).select_from(DeckORM)) or 0
    return deck_count > 0


def seed_cards_settings(db: Session) -> None:
    settings_orm = db.get(FlashcardSettingsORM, 1)
    if settings_orm is None:
        db.add(FlashcardSettingsORM(id=1))


def seed_already_done(db: Session) -> bool:
    settings_exists = db.get(FlashcardSettingsORM, 1) is not None
    decks_count = db.scalar(select(func.count()).select_from(DeckORM)) or 0
    cards_count = db.scalar(select(func.count()).select_from(FlashcardORM)) or 0

    return settings_exists and decks_count > 0 and cards_count > 0


def seed_flashcards() -> None:
    cards_payload = load_json("cards.json")
    logger.info("Loaded cards payload")

    with local_db_session() as db:
        if seed_already_done(db):
            logger.info("Flashcards are already present. Skipping seed")
            return

        decks_dict = load_json("decks.json")
        logger.info("Loaded decks payload")
        deck_records = seed_decks(db, decks_dict)
        logger.info("Seeded decks")
        card_count_by_deck = seed_cards(db, cards_payload, deck_records)
        logger.info("Seeded cards")
        seed_cards_settings(db)
        logger.info("Seeded settings")

        for deck_name, count in card_count_by_deck.items():
            deck_records[deck_name].card_count = count

        db.commit()


# def sync_terminal_exercises() -> tuple[int, int]:
#     payload = load_json("terminal-exercises.json")
#     if not isinstance(payload, list):
#         raise ValueError("terminal-exercises.json must contain an array payload")
#
#     inserted = 0
#     updated = 0
#
#     with local_db_session() as db:
#         existing = {
#             exercise.title: exercise
#             for exercise in db.scalars(
#                 select(TerminalExercise).order_by(TerminalExercise.id.asc())
#             ).all()
#         }
#
#         for exercise_data in payload:
#             title = str(exercise_data["title"])
#             next_fields = {
#                 "description": str(exercise_data["description"]),
#                 "track": str(exercise_data["track"]),
#                 "difficulty": str(exercise_data["difficulty"]),
#                 "scenario": str(exercise_data["scenario"]),
#                 "objectives": str(exercise_data["objectives"]),
#                 "valid_commands": str(exercise_data["validCommands"]),
#                 "ambient_commands": str(exercise_data.get("ambientCommands") or "[]"),
#                 "world_state": str(exercise_data.get("worldState") or "{}"),
#                 "initial_output": str(exercise_data["initialOutput"]),
#                 "completion_message": str(exercise_data["completionMessage"]),
#             }
#
#             current = existing.get(title)
#             if current is None:
#                 db.add(TerminalExercise(title=title, **next_fields))
#                 inserted += 1
#                 continue
#
#             changed = any(getattr(current, key) != value for key, value in next_fields.items())
#             if not changed:
#                 continue
#
#             for key, value in next_fields.items():
#                 setattr(current, key, value)
#             updated += 1
#
#         db.commit()
#
#     return inserted, updated


# def encode_json(value: object) -> str:
#     return json.dumps(value, separators=(",", ":"))
#
#
# def sync_real_env_exercises() -> tuple[int, int]:
#     ckad_payload = load_json("ckad-exercises.json")
#     real_env_payload = load_json("real-env-exercises.json")
#     if not isinstance(ckad_payload, list) or not isinstance(real_env_payload, list):
#         raise ValueError("exercise seed files must contain array payloads")
#
#     inserted = 0
#     updated = 0
#     combined = [*ckad_payload, *real_env_payload]
#
#     with local_db_session() as db:
#         existing = {
#             exercise.number: exercise
#             for exercise in db.scalars(select(CkadExercise).order_by(CkadExercise.id.asc())).all()
#         }
#
#         for exercise_data in combined:
#             number = int(exercise_data["number"])
#             next_fields = {
#                 "number": number,
#                 "title": str(exercise_data["title"]),
#                 "mode": str(exercise_data["mode"]),
#                 "track": str(exercise_data["track"]),
#                 "domain": str(exercise_data["domain"]),
#                 "difficulty": str(exercise_data["difficulty"]),
#                 "time_minutes": int(exercise_data["timeMinutes"]),
#                 "scenario": str(exercise_data["scenario"]),
#                 "hints": encode_json(exercise_data["hints"]),
#                 "solution": str(exercise_data["solution"]),
#                 "validations": encode_json(exercise_data["validations"]),
#                 "cleanup": encode_json(exercise_data["cleanup"]),
#             }
#
#             current = existing.get(number)
#             if current is None:
#                 db.add(CkadExercise(**next_fields))
#                 inserted += 1
#                 continue
#
#             changed = any(getattr(current, key) != value for key, value in next_fields.items())
#             if not changed:
#                 continue
#
#             for key, value in next_fields.items():
#                 setattr(current, key, value)
#             updated += 1
#
#         db.commit()
#
#     return inserted, updated


def main() -> None:
    configure_logging()
    logger.info("Starting seeding database..")
    initialize_db_schemas()
    logger.info("Initialized schemas")
    seed_flashcards()
    # terminal_inserted, terminal_updated = sync_terminal_exercises()
    # real_env_inserted, real_env_updated = sync_real_env_exercises()


if __name__ == "__main__":
    main()
