from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from time import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.orm.exercise_progress import ExerciseProgress
from backend.app.db.orm.terminal_exercise import TerminalExercise
from backend.app.schemas.terminal import ExerciseCommandResponse


@dataclass
class ValidCommand:
    command: str
    response: str
    partial: bool = False
    completes: bool = False


@dataclass
class AmbientCommand:
    command: str
    response: str


guided_exercise_history: dict[int, list[dict[str, object]]] = {}
blocked_terminal_commands = [
    "rm -rf /",
    "mkfs",
    "dd if=",
    ":(){ :|:& };:",
    "shutdown",
    "reboot",
    "halt",
]
terminal_workspace = tempfile.mkdtemp(prefix="blueaccademy-terminal-")
terminal_bin_dir = Path(terminal_workspace) / "bin"
terminal_home = os.environ.get("HOME", os.getcwd())
terminal_workspace_cleaned = False


def ensure_terminal_tooling() -> None:
    terminal_bin_dir.mkdir(parents=True, exist_ok=True)
    azlocal_shim_path = terminal_bin_dir / "azlocal"
    azlocal_shim = """#!/usr/bin/env bash
set -euo pipefail

endpoint="${MINIBLUE_ENDPOINT:-http://127.0.0.1:4566}"
subscription="00000000-0000-0000-0000-000000000000"
state_root="${AZLOCAL_STATE_DIR:-/tmp/blueaccademy-azlocal}"

usage() {
  echo "Usage: azlocal health | azlocal group|storage|keyvault ..." >&2
  exit 1
}

curl_json() {
  curl -fsS "$@"
}

json_ok() {
  printf '%s\\n' "$1"
}

state_dir() {
  mkdir -p "$state_root/$1"
  printf '%s' "$state_root/$1"
}

if [ "$#" -lt 1 ]; then
  usage
fi

cmd="$1"
shift

case "$cmd" in
  health)
    curl_json "$endpoint/health"
    ;;
  group)
    subcmd="${1:-}"
    [ -n "$subcmd" ] || usage
    shift
    name=""
    location=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --name) name="${2:-}"; shift 2 ;;
        --location) location="${2:-}"; shift 2 ;;
        --yes) shift ;;
        *) echo "Unsupported azlocal group flag: $1" >&2; exit 1 ;;
      esac
    done
    case "$subcmd" in
      create)
        [ -n "$name" ] && [ -n "$location" ] || usage
        body=$(printf '{"location":"%s"}' "$location")
        curl_json -X PUT -H "Content-Type: application/json" -d "$body" "$endpoint/subscriptions/$subscription/resourceGroups/$name?api-version=2021-04-01"
        ;;
      show)
        [ -n "$name" ] || usage
        curl_json "$endpoint/subscriptions/$subscription/resourceGroups/$name?api-version=2021-04-01"
        ;;
      list)
        curl_json "$endpoint/subscriptions/$subscription/resourceGroups?api-version=2021-04-01"
        ;;
      delete)
        [ -n "$name" ] || usage
        curl_json -X DELETE "$endpoint/subscriptions/$subscription/resourceGroups/$name?api-version=2021-04-01"
        ;;
      *) usage ;;
    esac
    ;;
  storage)
    area="${1:-}"
    [ -n "$area" ] || usage
    shift
    case "$area" in
      account)
        subcmd="${1:-}"; [ -n "$subcmd" ] || usage; shift
        name=""; resource_group=""; location=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --name) name="${2:-}"; shift 2 ;;
            --resource-group) resource_group="${2:-}"; shift 2 ;;
            --location) location="${2:-}"; shift 2 ;;
            *) echo "Unsupported azlocal storage account flag: $1" >&2; exit 1 ;;
          esac
        done
        case "$subcmd" in
          create)
            [ -n "$name" ] && [ -n "$resource_group" ] && [ -n "$location" ] || usage
            body=$(printf '{"location":"%s","kind":"StorageV2","sku":{"name":"Standard_LRS"}}' "$location")
            curl_json -X PUT -H "Content-Type: application/json" -d "$body" "$endpoint/subscriptions/$subscription/resourceGroups/$resource_group/providers/Microsoft.Storage/storageAccounts/$name?api-version=2021-04-01"
            ;;
          show)
            [ -n "$name" ] && [ -n "$resource_group" ] || usage
            curl_json "$endpoint/subscriptions/$subscription/resourceGroups/$resource_group/providers/Microsoft.Storage/storageAccounts/$name?api-version=2021-04-01"
            ;;
          *) usage ;;
        esac
        ;;
      container)
        subcmd="${1:-}"; [ -n "$subcmd" ] || usage; shift
        account=""; name=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --account) account="${2:-}"; shift 2 ;;
            --name) name="${2:-}"; shift 2 ;;
            *) echo "Unsupported azlocal storage container flag: $1" >&2; exit 1 ;;
          esac
        done
        case "$subcmd" in
          create)
            [ -n "$account" ] && [ -n "$name" ] || usage
            dir="$(state_dir storage)/$account/containers"
            mkdir -p "$dir"
            printf '{"name":"%s","account":"%s"}\\n' "$name" "$account" > "$dir/$name.json"
            json_ok "$(cat "$dir/$name.json")"
            ;;
          *) usage ;;
        esac
        ;;
      blob)
        subcmd="${1:-}"; [ -n "$subcmd" ] || usage; shift
        account=""; container=""; name=""; data=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --account) account="${2:-}"; shift 2 ;;
            --container) container="${2:-}"; shift 2 ;;
            --name) name="${2:-}"; shift 2 ;;
            --data) data="${2:-}"; shift 2 ;;
            *) echo "Unsupported azlocal storage blob flag: $1" >&2; exit 1 ;;
          esac
        done
        case "$subcmd" in
          upload)
            [ -n "$account" ] && [ -n "$container" ] && [ -n "$name" ] || usage
            dir="$(state_dir storage)/$account/blobs/$container"
            mkdir -p "$dir"
            printf '%s' "$data" > "$dir/$name.txt"
            printf '{"name":"%s","container":"%s","account":"%s"}\\n' "$name" "$container" "$account"
            ;;
          *) usage ;;
        esac
        ;;
      *) usage ;;
    esac
    ;;
  keyvault)
    area="${1:-}"
    case "$area" in
      create|show)
        subcmd="$area"
        if [ "$area" = "create" ] || [ "$area" = "show" ]; then
          shift 0
        fi
        name=""
        resource_group=""
        location=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --name) name="${2:-}"; shift 2 ;;
            --resource-group) resource_group="${2:-}"; shift 2 ;;
            --location) location="${2:-}"; shift 2 ;;
            *) echo "Unsupported azlocal keyvault flag: $1" >&2; exit 1 ;;
          esac
        done
        case "$subcmd" in
          create)
            [ -n "$name" ] && [ -n "$resource_group" ] && [ -n "$location" ] || usage
            body=$(printf '{"location":"%s","properties":{"tenantId":"00000000-0000-0000-0000-000000000001","sku":{"family":"A","name":"standard"},"accessPolicies":[],"enabledForDeployment":true,"enabledForTemplateDeployment":true,"enabledForDiskEncryption":true}}' "$location")
            curl_json -X PUT -H "Content-Type: application/json" -d "$body" "$endpoint/subscriptions/$subscription/resourceGroups/$resource_group/providers/Microsoft.KeyVault/vaults/$name?api-version=2021-04-01"
            ;;
          show)
            [ -n "$name" ] && [ -n "$resource_group" ] || usage
            curl_json "$endpoint/subscriptions/$subscription/resourceGroups/$resource_group/providers/Microsoft.KeyVault/vaults/$name?api-version=2021-04-01"
            ;;
        esac
        ;;
      secret)
        subcmd="${2:-}"; [ -n "$subcmd" ] || usage
        shift 2
        vault=""; name=""; value=""
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --vault) vault="${2:-}"; shift 2 ;;
            --name) name="${2:-}"; shift 2 ;;
            --value) value="${2:-}"; shift 2 ;;
            *) echo "Unsupported azlocal keyvault secret flag: $1" >&2; exit 1 ;;
          esac
        done
        case "$subcmd" in
          set)
            [ -n "$vault" ] && [ -n "$name" ] || usage
            dir="$(state_dir keyvault)/$vault"
            mkdir -p "$dir"
            printf '{"id":"%s","value":"%s","vault":"%s"}\\n' "$name" "$value" "$vault" > "$dir/$name.json"
            json_ok "$(cat "$dir/$name.json")"
            ;;
          show)
            [ -n "$vault" ] && [ -n "$name" ] || usage
            file="$(state_dir keyvault)/$vault/$name.json"
            [ -f "$file" ] || exit 1
            cat "$file"
            ;;
          *) usage ;;
        esac
        ;;
      *) usage ;;
    esac
    ;;
  *)
    usage
    ;;
esac
"""
    azlocal_shim_path.write_text(azlocal_shim, encoding="utf-8")
    azlocal_shim_path.chmod(0o755)


def cleanup_terminal_workspace() -> None:
    global terminal_workspace_cleaned
    if terminal_workspace_cleaned:
        return
    terminal_workspace_cleaned = True
    try:
        subprocess.run(
            ["rm", "-rf", terminal_workspace],
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception:
        pass


def normalize_guided_exercise_command(command: str) -> str:
    normalized = " ".join(command.strip().replace("\t", " ").split())
    if normalized == "k":
        normalized = "kubectl"
    elif normalized.startswith("k "):
        normalized = f"kubectl{normalized[1:]}"
    return (
        normalized.replace(" po ", " pods ")
        .replace(" pod ", " pods ")
        .replace(" deploy ", " deployments ")
        .replace(" deployment ", " deployments ")
        .replace(" svc ", " service ")
        .replace(" ns ", " namespace ")
    )


def expand_kubectl_alias(command: str) -> str:
    trimmed = command.strip()
    if trimmed == "k":
        return "kubectl"
    if trimmed.startswith("k "):
        return f"kubectl{trimmed[1:]}"
    return command


def execute_terminal_command(command: str) -> dict[str, object]:
    ensure_terminal_tooling()
    expanded_command = expand_kubectl_alias(command)
    if any(blocked in expanded_command for blocked in blocked_terminal_commands):
        return {
            "stdout": "",
            "stderr": "This command is not allowed in the sandbox.",
            "exitCode": 1,
        }

    env = dict(os.environ)
    env["HOME"] = terminal_home
    env["PATH"] = f"{terminal_bin_dir}:{env.get('PATH', '')}"
    try:
        result = subprocess.run(
            expanded_command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=terminal_workspace,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "stdout": (exc.stdout or "").rstrip(),
            "stderr": (exc.stderr or "Command timed out").rstrip(),
            "exitCode": 1,
        }
    except Exception as exc:  # pragma: no cover - defensive parity with TS path
        return {
            "stdout": "",
            "stderr": str(exc).rstrip(),
            "exitCode": 1,
        }

    stdout = (result.stdout or "")[: 1024 * 512].rstrip()
    stderr = (result.stderr or "")[: 1024 * 512].rstrip()
    return {
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": int(result.returncode),
    }


def list_exercises(db: Session, track: str | None = None) -> list[dict]:
    query = select(TerminalExercise).order_by(TerminalExercise.id.asc())
    if track:
        query = query.where(TerminalExercise.track == track)
    exercises = list(db.scalars(query).all())
    return [serialize_exercise(db, exercise) for exercise in exercises]


def get_exercise(db: Session, exercise_id: int) -> dict | None:
    exercise = db.get(TerminalExercise, exercise_id)
    if exercise is None:
        return None
    return serialize_exercise(db, exercise)


def reset_exercise(db: Session, exercise_id: int) -> bool:
    exercise = db.get(TerminalExercise, exercise_id)
    if exercise is None:
        return False
    progress = get_exercise_progress(db, exercise_id)
    if progress is None:
        progress = ExerciseProgress(
            exercise_id=exercise_id, completed=False, completed_at=None, attempts=0
        )
        db.add(progress)
    else:
        progress.completed = False
        progress.completed_at = None
        progress.attempts = 0
    db.commit()
    guided_exercise_history.pop(exercise_id, None)
    return True


def run_exercise_command(
    db: Session, exercise_id: int, command: str
) -> ExerciseCommandResponse | None:
    exercise = db.get(TerminalExercise, exercise_id)
    if exercise is None:
        return None

    trimmed = command.strip()
    normalized_trimmed = normalize_guided_exercise_command(" ".join(trimmed.split()))
    valid_commands = parse_valid_commands(exercise.valid_commands)
    ambient_commands = parse_ambient_commands(exercise.ambient_commands)
    progress = get_exercise_progress(db, exercise_id)
    expected_index = min(progress.attempts if progress else 0, max(len(valid_commands) - 1, 0))
    expected_command = valid_commands[expected_index] if valid_commands else None
    deterministic_terminal_output = get_deterministic_terminal_output(exercise, trimmed)

    match = None
    if expected_command and command_matches_candidate(
        exercise, normalized_trimmed, expected_command
    ):
        match = expected_command
    elif valid_commands:
        match = next(
            (
                candidate
                for candidate in valid_commands
                if command_matches_candidate(exercise, normalized_trimmed, candidate)
            ),
            None,
        )

    if match is None:
        if deterministic_terminal_output is not None:
            result = ExerciseCommandResponse(
                output=deterministic_terminal_output,
                valid=True,
                completes=False,
            )
            record_guided_exercise_history(exercise_id, trimmed, result.output, True)
            return result
        ambient_match = next(
            (
                candidate
                for candidate in ambient_commands
                if normalize_guided_exercise_command(" ".join(candidate.command.split()))
                == normalized_trimmed
            ),
            None,
        )
        if ambient_match is not None:
            result = ExerciseCommandResponse(
                output=ambient_match.response,
                valid=True,
                completes=False,
            )
            record_guided_exercise_history(exercise_id, trimmed, result.output, True)
            return result
        if not is_known_tool(trimmed):
            result = ExerciseCommandResponse(
                output=f"bash: {trimmed.split(' ')[0]}: command not found",
                valid=False,
                completes=False,
            )
            record_guided_exercise_history(exercise_id, trimmed, result.output, False)
            return result
        result = ExerciseCommandResponse(
            output="Command executed. (This command isn't part of the current exercise objectives.)",
            valid=True,
            completes=False,
        )
        record_guided_exercise_history(exercise_id, trimmed, result.output, True)
        return result

    if expected_command and match.command != expected_command.command:
        result = ExerciseCommandResponse(
            output=deterministic_terminal_output or match.response,
            valid=True,
            completes=False,
            matchedCommand=match.command,
        )
        record_guided_exercise_history(exercise_id, trimmed, result.output, True)
        return result

    should_complete = bool(match.completes) and expected_index == len(valid_commands) - 1
    upsert_exercise_progress(
        db,
        exercise_id,
        completed=should_complete or (progress.completed if progress else False),
        completed_at=round(time() * 1000)
        if should_complete
        else (progress.completed_at if progress else None),
        attempts=(progress.attempts if progress else 0) + 1,
    )
    result = ExerciseCommandResponse(
        output=deterministic_terminal_output or match.response,
        valid=True,
        completes=should_complete,
        completionMessage=exercise.completion_message if should_complete else None,
        matchedCommand=match.command,
    )
    record_guided_exercise_history(exercise_id, trimmed, result.output, True)
    return result


def parse_valid_commands(raw: str) -> list[ValidCommand]:
    try:
        payload = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    commands: list[ValidCommand] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        command = str(item.get("command", "")).strip()
        response = str(item.get("response", ""))
        if not command:
            continue
        commands.append(
            ValidCommand(
                command=command,
                response=response,
                partial=bool(item.get("partial", False)),
                completes=bool(item.get("completes", False)),
            )
        )
    return commands


def parse_ambient_commands(raw: str) -> list[AmbientCommand]:
    try:
        payload = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    commands: list[AmbientCommand] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        command = str(item.get("command") or item.get("pattern") or "").strip()
        response = str(item.get("response", ""))
        if not command:
            continue
        commands.append(AmbientCommand(command=command, response=response))
    return commands


def matches_valid_command(normalized_input: str, candidate: ValidCommand) -> bool:
    normalized_candidate = normalize_guided_exercise_command(" ".join(candidate.command.split()))
    if candidate.partial:
        return normalized_input == normalized_candidate or normalized_input.startswith(
            f"{normalized_candidate} "
        )
    return normalized_input == normalized_candidate


def command_matches_candidate(
    exercise: TerminalExercise,
    normalized_input: str,
    candidate: ValidCommand,
) -> bool:
    if matches_valid_command(normalized_input, candidate):
        return True
    normalized_candidate = normalize_guided_exercise_command(" ".join(candidate.command.split()))
    if matches_equivalent_kubernetes_command(normalized_input, normalized_candidate):
        return True
    return matches_exercise_specific_equivalent_command(
        exercise, normalized_input, normalized_candidate
    )


def get_exercise_progress(db: Session, exercise_id: int) -> ExerciseProgress | None:
    return db.scalar(select(ExerciseProgress).where(ExerciseProgress.exercise_id == exercise_id))


def upsert_exercise_progress(
    db: Session,
    exercise_id: int,
    *,
    completed: bool,
    completed_at: int | None,
    attempts: int,
) -> ExerciseProgress:
    progress = get_exercise_progress(db, exercise_id)
    if progress is None:
        progress = ExerciseProgress(exercise_id=exercise_id)
        db.add(progress)
    progress.completed = completed
    progress.completed_at = completed_at
    progress.attempts = attempts
    db.commit()
    db.refresh(progress)
    return progress


def serialize_exercise(db: Session, exercise: TerminalExercise) -> dict:
    progress = get_exercise_progress(db, exercise.id)
    return {
        "id": exercise.id,
        "title": exercise.title,
        "description": exercise.description,
        "track": exercise.track,
        "difficulty": exercise.difficulty,
        "scenario": exercise.scenario,
        "objectives": exercise.objectives,
        "validCommands": exercise.valid_commands,
        "initialOutput": exercise.initial_output,
        "completionMessage": exercise.completion_message,
        "progress": (
            {
                "id": progress.id,
                "exerciseId": progress.exercise_id,
                "completed": progress.completed,
                "completedAt": progress.completed_at,
                "attempts": progress.attempts,
            }
            if progress is not None
            else None
        ),
    }


def is_known_tool(command: str) -> bool:
    return (
        command.startswith("kubectl")
        or command.startswith("docker")
        or command.startswith("pulumi")
        or command.startswith("helm")
        or command.startswith("k")
        or command.startswith("ls")
        or command.startswith("cat")
        or command == "clear"
        or command == "help"
    )


def get_deterministic_terminal_output(exercise: TerminalExercise, command: str) -> str | None:
    shell_output = get_deterministic_shell_output(exercise, command)
    if shell_output is not None:
        return shell_output
    kubernetes_output = get_deterministic_kubernetes_output(exercise, command)
    if kubernetes_output is not None:
        return kubernetes_output
    pulumi_output = get_deterministic_pulumi_output(exercise, command)
    if pulumi_output is not None:
        return pulumi_output
    return get_deterministic_docker_output(exercise, command)


def get_deterministic_shell_output(exercise: TerminalExercise, command: str) -> str | None:
    normalized = " ".join(command.split())
    world_state = parse_kubernetes_world_state(exercise.world_state)
    files = world_state.get("files", [])
    if normalized == "ls" and isinstance(files, list) and files:
        return "  ".join(str(item) for item in files)
    cat_match = re.match(r"^cat ([^\s]+)$", normalized)
    if cat_match:
        target = cat_match.group(1)
        content = get_world_state_file_content(world_state, target)
        if content is not None:
            return content
    return None


def get_deterministic_kubernetes_output(exercise: TerminalExercise, command: str) -> str | None:
    normalized = normalize_guided_exercise_command(" ".join(command.split()))
    if not normalized.startswith("kubectl "):
        return None

    state = build_kubernetes_state_from_history(exercise)
    if normalized == "kubectl api-resources --namespaced=true":
        return (
            "NAME              SHORTNAMES   APIVERSION   NAMESPACED   KIND\n"
            "pods              po           v1           true         Pod\n"
            "services          svc          v1           true         Service\n"
            "deployments       deploy       apps/v1      true         Deployment\n"
            "configmaps        cm           v1           true         ConfigMap\n"
            "secrets                        v1           true         Secret"
        )
    if normalized == "kubectl version":
        return (
            "Client Version: v1.28.4\n"
            "Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3\n"
            "Server Version: v1.28.4"
        )
    get_target = parse_kubernetes_get_target(normalized)
    if get_target is not None:
        return format_kubernetes_get_output(state, get_target)

    describe_target = parse_kubernetes_describe_target(normalized)
    if describe_target is not None:
        return format_kubernetes_describe_output(state, describe_target)

    rollout_status_target = parse_kubernetes_rollout_status_target(normalized)
    if rollout_status_target is not None:
        return format_kubernetes_rollout_status_output(state, rollout_status_target)

    rollout_history_target = parse_kubernetes_rollout_history_target(normalized)
    if rollout_history_target is not None:
        return format_kubernetes_rollout_history_output(state, rollout_history_target)

    logs_target = parse_kubernetes_logs_target(normalized)
    if logs_target is not None:
        return format_kubernetes_logs_output(state, logs_target)

    events_target = parse_kubernetes_events_target(normalized)
    if events_target is not None:
        return format_kubernetes_events_output(state, events_target)

    get_all_target = parse_kubernetes_get_all_target(normalized)
    if get_all_target is not None:
        return format_kubernetes_get_all_output(state, get_all_target)

    top_target = parse_kubernetes_top_target(normalized)
    if top_target is not None:
        return format_kubernetes_top_output(state, top_target)

    return None


def get_deterministic_pulumi_output(exercise: TerminalExercise, command: str) -> str | None:
    normalized = " ".join(command.split())
    if not normalized.startswith("pulumi "):
        return None

    state = build_pulumi_state_from_history(exercise)

    if normalized == "pulumi stack ls":
        count = len(state["resources"])
        return "\n".join(
            [
                "NAME   LAST UPDATE  RESOURCE COUNT  URL",
                f"{state['selected_stack']}   {'just now' if state['updated'] or state['destroyed'] else 'n/a'}   {count}               file://~",
            ]
        )

    if normalized == "pulumi stack":
        return (
            f"Current stack is {state['selected_stack']}:\n"
            f"    Last updated: {'just now' if state['updated'] or state['destroyed'] else 'n/a'}\n"
            f"    Resource count: {len(state['resources'])}"
        )

    if normalized in {"pulumi config", "pulumi config ls"}:
        entries = list(state["config"].items())
        if not entries:
            return "No config values set"
        return "\n".join(["KEY   VALUE", *[f"{key}   {value}" for key, value in entries]])

    if normalized == "pulumi preview":
        if not state["resources"] and not state["updated"] and not state["destroyed"]:
            planned = state["planned_resources"]
            if not planned:
                return f"Previewing update ({state['selected_stack']}):\nResources:\n    0 changes"
            rows = [f" +   {resource['type']}  {resource['name']}  create" for resource in planned]
            return "\n".join(
                [
                    f"Previewing update ({state['selected_stack']}):",
                    "",
                    "     Type                 Name                 Plan",
                    *rows,
                    "",
                    "Resources:",
                    f"    + {len(planned)} to create",
                ]
            )
        return f"Previewing update ({state['selected_stack']}):\nResources:\n    0 changes"

    output_match = re.match(r"^pulumi stack output(?: ([^\s]+))?$", normalized)
    if output_match:
        output_name = output_match.group(1)
        if output_name:
            return str(
                state["outputs"].get(
                    output_name, f"error: no stack output named '{output_name}' found"
                )
            )
        entries = list(state["outputs"].items())
        if not entries:
            return "Current stack outputs (0):"
        return "\n".join(
            ["Current stack outputs:", *[f'    {key}: "{value}"' for key, value in entries]]
        )

    return None


def get_deterministic_docker_output(exercise: TerminalExercise, command: str) -> str | None:
    normalized = normalize_guided_exercise_command(" ".join(command.split()))
    history = guided_exercise_history.get(exercise.id, [])

    exec_output = format_docker_exec_output(exercise, normalized, history)
    if exec_output is not None:
        return exec_output

    top_output = format_docker_top_output(exercise, normalized, history)
    if top_output is not None:
        return top_output

    if normalized.startswith("docker inspect ") or normalized.startswith(
        "docker container inspect "
    ):
        return format_docker_inspect_output(exercise, normalized, history)

    if normalized.startswith("docker inspect --format=") or normalized.startswith(
        "docker container inspect --format="
    ):
        return format_docker_inspect_output(exercise, normalized, history)

    if normalized.startswith("docker logs "):
        return format_docker_logs_output(exercise, normalized, history)

    if normalized in {"docker images", "docker image ls"} or normalized.startswith(
        "docker images "
    ):
        images = build_docker_images_from_history(exercise, history)
        requested_ref = (
            normalized.split(" ", 2)[2] if normalized.startswith("docker images ") else None
        )
        filtered_images = (
            [image for image in images if docker_image_matches_ref(image, requested_ref)]
            if requested_ref
            else images
        )
        return format_docker_images_table(filtered_images)

    if normalized in {"docker ps", "docker ps -a"}:
        containers = build_docker_containers_from_history(exercise, history)
        if normalized == "docker ps":
            containers = [container for container in containers if container["running"]]
        return format_docker_ps_table(containers)

    if normalized == "docker system df":
        images = build_docker_images_from_history(exercise, history)
        containers = build_docker_containers_from_history(exercise, history)
        return format_docker_system_df(images, containers)

    return None


def parse_kubernetes_get_target(command: str) -> dict[str, object] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "get":
        return None
    return {
        "resource_type": parts[2],
        "resource_name": parts[3] if len(parts) > 3 and not parts[3].startswith("-") else None,
        "namespace": get_kubernetes_namespace(parts),
        "show_labels": "--show-labels" in parts,
        "output_format": "yaml" if "-o" in parts and "yaml" in parts else None,
    }


def parse_kubernetes_describe_target(command: str) -> dict[str, str | None] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "describe":
        return None
    resource_type = parts[2]
    if "/" in resource_type:
        resource_type, resource_name = resource_type.split("/", 1)
    else:
        resource_name = parts[3] if len(parts) > 3 and not parts[3].startswith("-") else None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
    }


def parse_kubernetes_rollout_status_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 4 or parts[0] != "kubectl" or parts[1] != "rollout" or parts[2] != "status":
        return None
    resource_target = parts[3]
    if "/" in resource_target:
        resource_type, resource_name = resource_target.split("/", 1)
    else:
        resource_type = resource_target
        resource_name = parts[4] if len(parts) > 4 and not parts[4].startswith("-") else ""
    if not resource_name:
        return None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
    }


def parse_kubernetes_rollout_history_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 4 or parts[0] != "kubectl" or parts[1] != "rollout" or parts[2] != "history":
        return None
    resource_target = parts[3]
    if "/" in resource_target:
        resource_type, resource_name = resource_target.split("/", 1)
    else:
        resource_type = resource_target
        resource_name = parts[4] if len(parts) > 4 and not parts[4].startswith("-") else ""
    if not resource_name:
        return None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
    }


def parse_kubernetes_get_all_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "get" or parts[2] != "all":
        return None
    return {"namespace": get_kubernetes_namespace(parts)}


def parse_kubernetes_logs_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "logs":
        return None
    pod_name = parts[2]
    if not pod_name or pod_name.startswith("-"):
        return None
    return {"pod_name": pod_name, "namespace": get_kubernetes_namespace(parts)}


def parse_kubernetes_events_target(command: str) -> dict[str, str | None] | None:
    parts = command.split()
    if not parts or parts[0] != "kubectl":
        return None
    if len(parts) >= 2 and parts[1] == "events":
        target = None
        for index, part in enumerate(parts):
            if part == "--for" and index + 1 < len(parts):
                target = parts[index + 1]
                break
            if part.startswith("--for="):
                target = part.split("=", 1)[1]
                break
        return {"namespace": get_kubernetes_namespace(parts), "target": target}
    if len(parts) >= 3 and parts[1] == "get" and parts[2] == "events":
        return {"namespace": get_kubernetes_namespace(parts), "target": None}
    return None


def parse_kubernetes_patch_service_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 4 or parts[0] != "kubectl" or parts[1] != "patch":
        return None
    resource_type = normalize_kubernetes_resource_type(parts[2])
    if resource_type != "services":
        return None
    service_name = parts[3]
    if not service_name or service_name.startswith("-"):
        return None
    return {"service_name": service_name, "namespace": get_kubernetes_namespace(parts)}


def parse_kubernetes_patch_target(command: str) -> dict[str, str] | None:
    parts = command.split()
    if len(parts) < 4 or parts[0] != "kubectl" or parts[1] != "patch":
        return None
    resource_type = normalize_kubernetes_resource_type(parts[2])
    resource_name = parts[3]
    if not resource_name or resource_name.startswith("-"):
        return None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
    }


def parse_kubernetes_scale_target(command: str) -> dict[str, object] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "scale":
        return None
    resource_target = parts[2]
    if "/" in resource_target:
        resource_type, resource_name = resource_target.split("/", 1)
    else:
        resource_type = resource_target
        resource_name = parts[3] if len(parts) > 3 and not parts[3].startswith("-") else ""
    if not resource_name:
        return None
    replicas_value = None
    for index, part in enumerate(parts):
        if part.startswith("--replicas="):
            replicas_value = part.split("=", 1)[1]
            break
        if part == "--replicas" and index + 1 < len(parts):
            replicas_value = parts[index + 1]
            break
    if replicas_value is None or not replicas_value.isdigit():
        return None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
        "replicas": int(replicas_value),
    }


def parse_kubernetes_top_target(command: str) -> dict[str, str | None] | None:
    parts = command.split()
    if len(parts) < 3 or parts[0] != "kubectl" or parts[1] != "top":
        return None
    resource_type = parts[2]
    resource_name = parts[3] if len(parts) > 3 and not parts[3].startswith("-") else None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "namespace": get_kubernetes_namespace(parts),
    }


def get_kubernetes_namespace(parts: list[str]) -> str:
    for index, part in enumerate(parts):
        if part in {"-n", "--namespace"} and index + 1 < len(parts):
            return parts[index + 1]
        if part.startswith("--namespace="):
            return part.split("=", 1)[1]
    return "default"


def get_kubernetes_namespace_with_fallback(command: str, fallback_namespace: str) -> str:
    return get_kubernetes_namespace(command.split()) or fallback_namespace


def parse_kubernetes_world_state(raw_world_state: str) -> dict[str, object]:
    try:
        payload = json.loads(raw_world_state or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def get_kubernetes_resource_name(command: str, resource_aliases: list[str]) -> str | None:
    parts = command.split()
    for index, part in enumerate(parts):
        if part in resource_aliases and index + 1 < len(parts):
            candidate = parts[index + 1]
            if not candidate.startswith("-"):
                return candidate
    return None


def get_kubernetes_pod_namespace(pod: dict[str, object], fallback_namespace: str) -> str:
    return str(pod.get("namespace", fallback_namespace))


def get_kubernetes_deployment_namespace(
    deployment: dict[str, object], fallback_namespace: str
) -> str:
    return str(deployment.get("namespace", fallback_namespace))


def get_kubernetes_selector_labels(deployment: dict[str, object]) -> dict[str, str]:
    raw_selector = deployment.get("selector", f"app={deployment.get('name', 'app')}")
    if isinstance(raw_selector, dict):
        return {str(key): str(value) for key, value in raw_selector.items()}
    selector = str(raw_selector)
    labels: dict[str, str] = {}
    for item in selector.split(","):
        item = item.strip()
        if not item:
            continue
        key, _, value = item.partition("=")
        labels[key] = value or "true"
    return labels


def get_stable_terminal_id(seed: str, length: int = 10) -> str:
    digits = "".join(str((ord(char) * (index + 3)) % 10) for index, char in enumerate(seed))
    return (digits + "0123456789" * 3)[:length]


def get_kubernetes_replica_set_name(
    deployment_name: str,
    pods: list[dict[str, object]],
    namespace: str,
) -> str:
    pod = next(
        (
            candidate
            for candidate in pods
            if get_kubernetes_pod_namespace(candidate, namespace) == namespace
            and str(candidate.get("name", "")).startswith(f"{deployment_name}-")
        ),
        None,
    )
    if pod is None:
        return f"{deployment_name}-{get_stable_terminal_id(f'{namespace}:{deployment_name}')}"
    pod_name = str(pod.get("name", ""))
    parts = pod_name.split("-")
    return "-".join(parts[:-1]) if len(parts) > 1 else pod_name


def parse_kubernetes_set_env_command(command: str) -> dict[str, object] | None:
    parts = command.split()
    if len(parts) < 5 or parts[0] != "kubectl" or parts[1] != "set" or parts[2] != "env":
        return None
    resource_target = parts[3]
    if "/" in resource_target:
        resource_type, deployment_name = resource_target.split("/", 1)
    else:
        resource_type = resource_target
        deployment_name = parts[4] if len(parts) > 4 and not parts[4].startswith("-") else ""
    if resource_type not in {"deployment", "deploy", "deployments"} or not deployment_name:
        return None

    assignments: dict[str, str] = {}
    for index, part in enumerate(
        parts[4 if "/" in resource_target else 5 :], start=4 if "/" in resource_target else 5
    ):
        if part in {"-n", "--namespace", "--container"}:
            continue
        if index > 0 and parts[index - 1] in {"-n", "--namespace", "--container"}:
            continue
        if (
            part.startswith("--namespace=")
            or part.startswith("--container=")
            or part == "--overwrite"
        ):
            continue
        key, _, value = part.partition("=")
        if key and value:
            assignments[key] = value
    if not assignments:
        return None
    return {"deployment_name": deployment_name, "assignments": assignments}


def parse_kubernetes_set_image_command(command: str) -> dict[str, object] | None:
    parts = command.split()
    if len(parts) < 5 or parts[0] != "kubectl" or parts[1] != "set" or parts[2] != "image":
        return None
    resource_target = parts[3]
    if "/" in resource_target:
        resource_type, resource_name = resource_target.split("/", 1)
        start_index = 4
    else:
        resource_type = resource_target
        resource_name = parts[4] if len(parts) > 4 and not parts[4].startswith("-") else ""
        start_index = 5
    if not resource_name:
        return None

    assignments: dict[str, str] = {}
    for index, part in enumerate(parts[start_index:], start=start_index):
        if part in {"-n", "--namespace", "--container"}:
            continue
        if index > 0 and parts[index - 1] in {"-n", "--namespace", "--container"}:
            continue
        if (
            part.startswith("--namespace=")
            or part.startswith("--container=")
            or part in {"--record", "--local"}
        ):
            continue
        key, _, value = part.partition("=")
        if key and value:
            assignments[key] = value
    if not assignments:
        return None
    return {
        "resource_type": resource_type,
        "resource_name": resource_name,
        "assignments": assignments,
    }


def build_kubernetes_state_from_history(exercise: TerminalExercise) -> dict[str, object]:
    world_state = parse_kubernetes_world_state(exercise.world_state)
    history = guided_exercise_history.get(exercise.id, [])
    default_namespace = str(world_state.get("namespace", "default"))
    namespaces = {
        "default",
        "kube-system",
        default_namespace,
        *[str(item) for item in world_state.get("namespaces", []) if isinstance(item, str)],
    }
    deployments = [
        dict(item) for item in world_state.get("deployments", []) if isinstance(item, dict)
    ]
    nodes = [dict(item) for item in world_state.get("nodes", []) if isinstance(item, dict)]
    pods = [dict(item) for item in world_state.get("pods", []) if isinstance(item, dict)]
    services = [dict(item) for item in world_state.get("services", []) if isinstance(item, dict)]
    network_policies = [
        dict(item) for item in world_state.get("networkPolicies", []) if isinstance(item, dict)
    ]
    configmaps = [
        dict(item) for item in world_state.get("configMaps", []) if isinstance(item, dict)
    ]
    namespace_labels = (
        {
            namespace: dict(labels)
            for namespace, labels in world_state.get("namespaceLabels", {}).items()
            if isinstance(labels, dict)
        }
        if isinstance(world_state.get("namespaceLabels"), dict)
        else {}
    )
    rollout_history = (
        {
            key: [dict(item) for item in value if isinstance(item, dict)]
            for key, value in world_state.get("rolloutHistory", {}).items()
            if isinstance(value, list)
        }
        if isinstance(world_state.get("rolloutHistory"), dict)
        else {}
    )

    for deployment in deployments:
        namespaces.add(get_kubernetes_deployment_namespace(deployment, default_namespace))
    for pod in pods:
        namespaces.add(get_kubernetes_pod_namespace(pod, default_namespace))
    for service in services:
        namespaces.add(str(service.get("namespace", default_namespace)))

    def resolve_service_endpoints(service: dict[str, object]) -> list[str]:
        selector = service.get("selector", {})
        selector_labels = (
            {str(key): str(value) for key, value in selector.items()}
            if isinstance(selector, dict)
            else get_kubernetes_selector_labels({"selector": selector})
        )
        namespace = str(service.get("namespace", default_namespace))
        target_port = str(service.get("targetPort", service.get("port", 80)))
        endpoints: list[str] = []
        for pod in pods:
            if get_kubernetes_pod_namespace(pod, namespace) != namespace:
                continue
            labels = pod.get("labels", {})
            if not isinstance(labels, dict):
                continue
            if all(str(labels.get(key)) == value for key, value in selector_labels.items()):
                pod_ip = str(pod.get("ip", "")).strip()
                if pod_ip:
                    endpoints.append(f"{pod_ip}:{target_port}")
        return endpoints

    def refresh_service_endpoints() -> None:
        for service in services:
            service["endpoints"] = resolve_service_endpoints(service)

    def set_deployment_replicas(name: str, namespace: str, desired: int) -> None:
        deployment = next(
            (
                candidate
                for candidate in deployments
                if candidate.get("name") == name
                and get_kubernetes_deployment_namespace(candidate, default_namespace) == namespace
            ),
            None,
        )
        if deployment is None:
            return
        deployment["namespace"] = namespace
        deployment["replicas"] = f"{desired}/{desired}"
        selector_labels = get_kubernetes_selector_labels(deployment)
        matching_pods = [
            candidate
            for candidate in pods
            if get_kubernetes_pod_namespace(candidate, namespace) == namespace
            and str(candidate.get("name", "")).startswith(f"{name}-")
        ]
        while len(matching_pods) > desired:
            pods.remove(matching_pods.pop())
        while len(matching_pods) < desired:
            suffix = get_stable_terminal_id(f"{namespace}:{name}:{len(matching_pods)}", 5)
            pod = {
                "name": f"{name}-{suffix}",
                "namespace": namespace,
                "status": "Running",
                "restarts": 0,
                "age": "20s",
                "labels": selector_labels,
            }
            pods.append(pod)
            matching_pods.append(pod)
        for pod in matching_pods:
            pod["status"] = "Running"
            pod["restarts"] = int(pod.get("restarts", 0))

    def restart_deployment_pods(name: str, namespace: str, seed: str) -> None:
        deployment = next(
            (
                candidate
                for candidate in deployments
                if candidate.get("name") == name
                and get_kubernetes_deployment_namespace(candidate, default_namespace) == namespace
            ),
            None,
        )
        if deployment is None:
            return
        replicas_text = str(deployment.get("replicas", "1/1"))
        desired = int(replicas_text.split("/")[-1] or "1")
        selector_labels = get_kubernetes_selector_labels(deployment)
        pods[:] = [
            candidate
            for candidate in pods
            if not (
                get_kubernetes_pod_namespace(candidate, namespace) == namespace
                and str(candidate.get("name", "")).startswith(f"{name}-")
            )
        ]
        replica_set_hash = get_stable_terminal_id(f"{namespace}:{name}:{seed}", 10)
        for index in range(desired):
            pods.append(
                {
                    "name": f"{name}-{replica_set_hash}-{get_stable_terminal_id(f'{seed}:{index}', 5)}",
                    "namespace": namespace,
                    "status": "Running",
                    "restarts": 0,
                    "age": "20s",
                    "labels": selector_labels,
                }
            )

    for index, entry in enumerate(history):
        command = normalize_guided_exercise_command(str(entry["command"]))
        namespace = get_kubernetes_namespace_with_fallback(command, default_namespace)

        create_namespace_match = re.match(
            r"^kubectl create (?:namespace|namespaces|ns) ([^\s]+)$", command
        )
        if create_namespace_match:
            namespaces.add(create_namespace_match.group(1))
            continue

        label_namespace_match = re.match(
            r"^kubectl label (?:namespace|namespaces|ns) ([^\s]+) ([A-Za-z0-9_.-]+)=([^\s]+)$",
            command,
        )
        if label_namespace_match:
            namespace_name, key, value = label_namespace_match.groups()
            namespaces.add(namespace_name)
            namespace_labels[namespace_name] = {
                **namespace_labels.get(namespace_name, {}),
                key: value,
            }
            continue

        scale_match = re.match(
            r"^kubectl scale (?:deployments?|deploy)(?:/|\s+)([^\s]+).*--replicas(?:=|\s+)([0-9]+)",
            command,
        )
        if scale_match:
            set_deployment_replicas(scale_match.group(1), namespace, int(scale_match.group(2)))
            continue

        set_env = parse_kubernetes_set_env_command(command)
        if set_env is not None:
            deployment = next(
                (
                    candidate
                    for candidate in deployments
                    if candidate.get("name") == set_env["deployment_name"]
                    and get_kubernetes_deployment_namespace(candidate, default_namespace)
                    == namespace
                ),
                None,
            )
            if deployment is not None:
                deployment["env"] = {
                    **(
                        deployment.get("env", {}) if isinstance(deployment.get("env"), dict) else {}
                    ),
                    **dict(set_env["assignments"]),
                }
                restart_deployment_pods(
                    str(set_env["deployment_name"]), namespace, f"set-env:{index}:{command}"
                )
            continue

        expose_match = re.match(r"^kubectl expose (?:deployments?|deploy) ([^\s]+)", command)
        if expose_match:
            deployment_name = expose_match.group(1)
            service_name_match = re.search(r"(?:^|\s)--name(?:=|\s)([^\s]+)", command)
            port_match = re.search(r"(?:^|\s)--port(?:=|\s)([0-9]+)", command)
            service_name = service_name_match.group(1) if service_name_match else deployment_name
            if not any(
                candidate.get("name") == service_name
                and str(candidate.get("namespace", namespace)) == namespace
                for candidate in services
            ):
                services.append(
                    {
                        "name": service_name,
                        "namespace": namespace,
                        "type": "ClusterIP",
                        "clusterIP": "10.96.144.211",
                        "port": int(port_match.group(1)) if port_match else 80,
                        "selector": f"app={deployment_name}",
                        "age": "10s",
                    }
                )
            continue

        patch_service = parse_kubernetes_patch_service_target(command)
        if patch_service is not None:
            service = next(
                (
                    candidate
                    for candidate in services
                    if candidate.get("name") == patch_service["service_name"]
                    and str(candidate.get("namespace", namespace)) == namespace
                ),
                None,
            )
            if service is None:
                continue
            selector_block_matches = re.findall(r'"selector"\s*:\s*\{([^}]*)\}', command)
            if selector_block_matches:
                selector_items = re.findall(
                    r'"([^"]+)"\s*:\s*"([^"]+)"', selector_block_matches[-1]
                )
                if selector_items:
                    service["selector"] = {key: value for key, value in selector_items}
            else:
                simple_app_match = re.search(r'app["\']?\s*[:=]\s*["\']?([A-Za-z0-9_.-]+)', command)
                if simple_app_match:
                    service["selector"] = {"app": simple_app_match.group(1)}
            continue

        patch_target = parse_kubernetes_patch_target(command)
        if patch_target is not None:
            if patch_target["resource_type"] == "deployments":
                deployment = next(
                    (
                        candidate
                        for candidate in deployments
                        if candidate.get("name") == patch_target["resource_name"]
                        and get_kubernetes_deployment_namespace(candidate, default_namespace)
                        == namespace
                    ),
                    None,
                )
                if deployment is not None:
                    resource_requests = deployment.get("resourceRequests", {})
                    if not isinstance(resource_requests, dict):
                        resource_requests = {}
                    cpu_match = re.search(r'"cpu"\s*:\s*"([^"]+)"', command)
                    memory_match = re.search(r'"memory"\s*:\s*"([^"]+)"', command)
                    if cpu_match:
                        resource_requests["cpu"] = cpu_match.group(1)
                    if memory_match:
                        resource_requests["memory"] = memory_match.group(1)
                    deployment["resourceRequests"] = resource_requests
                    replicas_text = str(deployment.get("replicas", "1/1"))
                    desired = int(replicas_text.split("/")[-1] or "1")
                    set_deployment_replicas(str(deployment.get("name", "")), namespace, desired)
                continue

            if patch_target["resource_type"] == "configmap":
                configmap = next(
                    (
                        candidate
                        for candidate in configmaps
                        if str(candidate.get("name", "")) == patch_target["resource_name"]
                        and str(candidate.get("namespace", namespace)) == namespace
                    ),
                    None,
                )
                if configmap is not None:
                    data = configmap.get("data", {})
                    if not isinstance(data, dict):
                        data = {}
                    for key, value in re.findall(r'"([A-Za-z0-9_.-]+)"\s*:\s*"([^"]*)"', command):
                        if key != "data":
                            data[key] = value
                    configmap["data"] = data
                continue

            if patch_target["resource_type"] == "netpol":
                policy = next(
                    (
                        candidate
                        for candidate in network_policies
                        if str(candidate.get("name", "")) == patch_target["resource_name"]
                        and str(candidate.get("namespace", namespace)) == namespace
                    ),
                    None,
                )
                if policy is not None:
                    label_matches = re.findall(r'"([A-Za-z0-9_.-]+)"\s*:\s*"([^"]+)"', command)
                    if label_matches:
                        for key, value in label_matches:
                            if key not in {
                                "spec",
                                "matchLabels",
                                "namespaceSelector",
                                "ingress",
                                "from",
                                "ports",
                                "protocol",
                                "podSelector",
                            }:
                                policy["allowedNamespaceLabel"] = f"{key}={value}"
                    port_match = re.search(r'"port"\s*:\s*([0-9]+)', command)
                    if port_match:
                        policy["port"] = int(port_match.group(1))
                continue

        rollout_undo_match = re.match(
            r"^kubectl rollout undo (?:deployments?/|deploy/|deployments?\s+|deploy\s+)([^\s]+)",
            command,
        )
        if rollout_undo_match:
            deployment_name = rollout_undo_match.group(1)
            deployment = next(
                (
                    candidate
                    for candidate in deployments
                    if candidate.get("name") == deployment_name
                    and get_kubernetes_deployment_namespace(candidate, default_namespace)
                    == namespace
                ),
                None,
            )
            if deployment is not None and deployment.get("previousImage"):
                deployment["image"] = deployment["previousImage"]
                replicas_text = str(deployment.get("replicas", "1/1"))
                set_deployment_replicas(
                    deployment_name, namespace, int(replicas_text.split("/")[-1] or "1")
                )
                history_entries = rollout_history.setdefault(deployment_name, [])
                if history_entries:
                    max_revision = max(int(item.get("revision", 0)) for item in history_entries)
                else:
                    max_revision = 0
                history_entries.append({"revision": max_revision + 1, "image": deployment["image"]})
            continue

        set_image = parse_kubernetes_set_image_command(command)
        if set_image is not None:
            deployment = next(
                (
                    candidate
                    for candidate in deployments
                    if candidate.get("name") == set_image["resource_name"]
                    and get_kubernetes_deployment_namespace(candidate, default_namespace)
                    == namespace
                ),
                None,
            )
            if deployment is not None:
                current_image = str(deployment.get("image", ""))
                deployment["previousImage"] = current_image
                image_value = next(iter(dict(set_image["assignments"]).values()))
                deployment["image"] = image_value
                history_entries = rollout_history.setdefault(str(set_image["resource_name"]), [])
                if history_entries:
                    max_revision = max(int(item.get("revision", 0)) for item in history_entries)
                else:
                    max_revision = 0
                history_entries.append({"revision": max_revision + 1, "image": image_value})
                replicas_text = str(deployment.get("replicas", "1/1"))
                set_deployment_replicas(
                    str(set_image["resource_name"]),
                    namespace,
                    int(replicas_text.split("/")[-1] or "1"),
                )
                restart_deployment_pods(
                    str(set_image["resource_name"]), namespace, f"set-image:{index}:{command}"
                )
            continue

        rollout_restart_match = re.match(
            r"^kubectl rollout restart (?:deployments?/|deployments?\s+)([^\s]+)",
            command,
        )
        if rollout_restart_match:
            restart_deployment_pods(
                rollout_restart_match.group(1), namespace, f"rollout-restart:{index}:{command}"
            )

    refresh_service_endpoints()

    return {
        "world_state": world_state,
        "default_namespace": default_namespace,
        "namespaces": namespaces,
        "namespace_labels": namespace_labels,
        "nodes": nodes,
        "deployments": deployments,
        "pods": pods,
        "services": services,
        "network_policies": network_policies,
        "configmaps": configmaps,
        "rollout_history": rollout_history,
    }


def build_pulumi_state_from_history(exercise: TerminalExercise) -> dict[str, object]:
    world_state = parse_kubernetes_world_state(exercise.world_state)
    history = guided_exercise_history.get(exercise.id, [])

    selected_stack = str(world_state.get("stack", "dev"))
    config = dict(
        world_state.get("config", {}) if isinstance(world_state.get("config"), dict) else {}
    )
    resources = list(
        world_state.get("resources", []) if isinstance(world_state.get("resources"), list) else []
    )
    outputs = dict(
        world_state.get("outputs", {}) if isinstance(world_state.get("outputs"), dict) else {}
    )
    planned_resources = [
        {
            "type": str(resource.get("type", "resource")),
            "name": str(resource.get("name", "unnamed")),
        }
        for resource in resources
    ]
    updated = False
    destroyed = False

    for entry in history:
        command = " ".join(str(entry["command"]).split())
        select_match = re.match(r"^pulumi stack select ([^\s]+)$", command)
        if select_match:
            selected_stack = select_match.group(1)
            continue

        config_set_match = re.match(r"^pulumi config set ([^\s]+) (.+)$", command)
        if config_set_match:
            config[config_set_match.group(1)] = config_set_match.group(2).strip()
            continue

        if command in {"pulumi up --yes", "pulumi up -y"}:
            updated = True
            if not resources:
                resources = planned_resources or [
                    {
                        "type": "pulumi:pulumi:Stack",
                        "name": f"{world_state.get('project', 'project')}-{selected_stack}",
                    }
                ]
            if not outputs and world_state.get("project") == "myinfra":
                outputs["bucketName"] = "my-versioned-bucket-a3b4c5d"
            continue

        if command in {"pulumi destroy --yes", "pulumi destroy -y"}:
            resources = []
            outputs = {}
            destroyed = True

    return {
        "selected_stack": selected_stack,
        "config": config,
        "resources": resources,
        "outputs": outputs,
        "planned_resources": planned_resources,
        "updated": updated,
        "destroyed": destroyed,
    }


def normalize_kubernetes_resource_type(resource_type: str) -> str:
    aliases = {
        "ns": "namespaces",
        "namespace": "namespaces",
        "deployment": "deployments",
        "deploy": "deployments",
        "pod": "pods",
        "po": "pods",
        "service": "services",
        "svc": "services",
        "networkpolicy": "netpol",
        "networkpolicies": "netpol",
        "netpol": "netpol",
    }
    return aliases.get(resource_type, resource_type)


def format_kubernetes_get_output(state: dict[str, object], target: dict[str, object]) -> str | None:
    resource_type = normalize_kubernetes_resource_type(str(target["resource_type"]))
    resource_name = target["resource_name"]
    namespace = str(target["namespace"] or state["default_namespace"])
    show_labels = bool(target["show_labels"])
    output_format = target.get("output_format")

    if resource_type == "namespaces":
        namespaces = sorted(str(item) for item in state["namespaces"])
        if resource_name is not None:
            namespaces = [item for item in namespaces if item == resource_name]
        if show_labels:
            labels_map = state["namespace_labels"]
            rows = ["NAME        STATUS   LABELS"]
            for namespace_item in namespaces:
                labels = {
                    "kubernetes.io/metadata.name": namespace_item,
                    **labels_map.get(namespace_item, {}),
                }
                label_text = ",".join(f"{key}={value}" for key, value in labels.items()) or "<none>"
                rows.append(f"{namespace_item:<11} Active   {label_text}")
            return "\n".join(rows) if len(rows) > 1 else "No resources found."
        rows = ["NAME        STATUS"]
        rows.extend(f"{namespace_item:<11} Active" for namespace_item in namespaces)
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "deployments":
        deployments = [
            item
            for item in state["deployments"]
            if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            deployments = [
                item for item in deployments if str(item.get("name", "")) == resource_name
            ]
        rows = ["NAME   READY   UP-TO-DATE   AVAILABLE   AGE"]
        for deployment in deployments:
            replicas = str(deployment.get("replicas", "1/1"))
            ready, _, desired = replicas.partition("/")
            desired = desired or ready or "1"
            rows.append(
                f"{str(deployment.get('name', ''))}   {ready}/{desired}   {desired}   {ready}   {str(deployment.get('age', '2d'))}"
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "pods":
        pods = [
            item for item in state["pods"] if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            pods = [item for item in pods if str(item.get("name", "")) == resource_name]
        header = (
            "NAME   READY   STATUS   RESTARTS   AGE   LABELS"
            if show_labels
            else "NAME   READY   STATUS   RESTARTS   AGE"
        )
        rows = [header]
        for pod in pods:
            status = str(pod.get("status", "Running"))
            ready = "1/1" if status == "Running" else "0/1"
            labels = (
                ",".join(f"{key}={value}" for key, value in pod.get("labels", {}).items())
                if isinstance(pod.get("labels"), dict)
                else "<none>"
            )
            rows.append(
                (
                    f"{str(pod.get('name', ''))}   {ready}   {status}   {str(pod.get('restarts', 0))}   {str(pod.get('age', '2d'))}   {labels}"
                    if show_labels
                    else f"{str(pod.get('name', ''))}   {ready}   {status}   {str(pod.get('restarts', 0))}   {str(pod.get('age', '2d'))}"
                )
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "services":
        services = [
            item for item in state["services"] if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            services = [item for item in services if str(item.get("name", "")) == resource_name]
        if output_format == "yaml" and resource_name is not None:
            service = services[0] if services else None
            if service is None:
                return "No resources found."
            selector = service.get("selector", {})
            selector_lines = (
                [f"    {key}: {value}" for key, value in selector.items()]
                if isinstance(selector, dict) and selector
                else ["    <none>: <none>"]
            )
            return "\n".join(
                [
                    "spec:",
                    "  selector:",
                    *selector_lines,
                    "  ports:",
                    f"  - port: {service.get('port', 80)}",
                    f"    targetPort: {service.get('targetPort', service.get('port', 80))}",
                ]
            )
        rows = ["NAME   TYPE   CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE"]
        for service in services:
            rows.append(
                f"{str(service.get('name', ''))}   {str(service.get('type', 'ClusterIP'))}   {str(service.get('clusterIP', '10.96.144.211'))}   <none>   {str(service.get('port', 80))}/TCP   {str(service.get('age', '10s'))}"
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "endpoints":
        services = [
            item for item in state["services"] if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            services = [item for item in services if str(item.get("name", "")) == resource_name]
        rows = ["NAME   ENDPOINTS   AGE"]
        for service in services:
            endpoints = service.get("endpoints", [])
            endpoint_text = ",".join(str(item) for item in endpoints) if endpoints else "<none>"
            rows.append(
                f"{str(service.get('name', ''))}   {endpoint_text}   {str(service.get('age', '2d'))}"
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "configmaps":
        configmaps = [
            item
            for item in state["configmaps"]
            if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            configmaps = [item for item in configmaps if str(item.get("name", "")) == resource_name]
        if output_format == "yaml" and resource_name is not None:
            configmap = configmaps[0] if configmaps else None
            if configmap is None:
                return "No resources found."
            data = configmap.get("data", {}) if isinstance(configmap.get("data"), dict) else {}
            yaml_lines = [
                "apiVersion: v1",
                "kind: ConfigMap",
                "metadata:",
                f"  name: {resource_name}",
                "data:",
            ]
            if data:
                yaml_lines.extend(f"  {key}: {value}" for key, value in data.items())
            else:
                yaml_lines.append("  {}")
            return "\n".join(yaml_lines)
        rows = ["NAME   DATA   AGE"]
        for configmap in configmaps:
            data = configmap.get("data", {})
            data_count = len(data) if isinstance(data, dict) else 0
            rows.append(
                f"{str(configmap.get('name', ''))}   {data_count}   {str(configmap.get('age', '10d'))}"
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    if resource_type == "netpol":
        policies = [
            item
            for item in state["network_policies"]
            if str(item.get("namespace", namespace)) == namespace
        ]
        if resource_name is not None:
            policies = [item for item in policies if str(item.get("name", "")) == resource_name]
        if output_format == "yaml" and resource_name is not None:
            policy = policies[0] if policies else None
            if policy is None:
                return "No resources found."
            selector = str(policy.get("podSelector", ""))
            selector_key, _, selector_value = selector.partition("=")
            allowed = str(policy.get("allowedNamespaceLabel", "name=default"))
            allowed_key, _, allowed_value = allowed.partition("=")
            port = policy.get("port", 9090)
            return "\n".join(
                [
                    "spec:",
                    "  podSelector:",
                    "    matchLabels:",
                    f"      {selector_key}: {selector_value}",
                    "  ingress:",
                    "  - from:",
                    "    - namespaceSelector:",
                    "        matchLabels:",
                    f"          {allowed_key}: {allowed_value}",
                    "    ports:",
                    "    - protocol: TCP",
                    f"      port: {port}",
                ]
            )
        rows = ["NAME   POD-SELECTOR   AGE"]
        for policy in policies:
            rows.append(
                f"{str(policy.get('name', ''))}   {str(policy.get('podSelector', '<none>'))}   {str(policy.get('age', '3d'))}"
            )
        return "\n".join(rows) if len(rows) > 1 else "No resources found."

    return None


def format_kubernetes_describe_output(
    state: dict[str, object], target: dict[str, str | None]
) -> str | None:
    resource_type = normalize_kubernetes_resource_type(str(target["resource_type"]))
    resource_name = target["resource_name"]
    namespace = str(target["namespace"] or state["default_namespace"])

    if resource_type == "pods" and resource_name:
        pods = [
            item for item in state["pods"] if str(item.get("namespace", namespace)) == namespace
        ]
        pod = next((item for item in pods if str(item.get("name", "")) == resource_name), None)
        if pod is None:
            return f'Error from server (NotFound): pods "{resource_name}" not found'
        deployment = next(
            (
                item
                for item in state["deployments"]
                if str(item.get("namespace", namespace)) == namespace
                and str(pod.get("name", "")).startswith(f"{item.get('name', '')}-")
            ),
            None,
        )
        label_text = (
            ",".join(f"{key}={value}" for key, value in pod.get("labels", {}).items())
            if isinstance(pod.get("labels"), dict)
            else "<none>"
        )
        env_entries = (
            deployment.get("env", {})
            if isinstance(deployment, dict) and isinstance(deployment.get("env"), dict)
            else {}
        )
        lines = [
            f"Name:             {pod.get('name', '')}",
            f"Namespace:        {namespace}",
            "Priority:         0",
            f"Status:           {pod.get('status', 'Unknown')}",
            f"IP:               {pod.get('ip', '10.42.0.18')}",
            f"Controlled By:    ReplicaSet/{get_kubernetes_replica_set_name(str(deployment.get('name') if isinstance(deployment, dict) else pod.get('name', 'app')), [pod], namespace)}",
            f"Labels:           {label_text}",
            "Containers:",
            f"  {str(deployment.get('name') if isinstance(deployment, dict) else 'app')}:",
            f"    Image:        {str(deployment.get('image') if isinstance(deployment, dict) else 'app:latest')}",
            f"    Ready:        {'True' if str(pod.get('status', '')) == 'Running' else 'False'}",
            "    Environment:",
        ]
        if env_entries:
            lines.extend([f"      {key}:  {value}" for key, value in env_entries.items()])
        else:
            lines.append("      <none>")
        if pod.get("reason"):
            lines.extend(
                [
                    "Events:",
                    "  Type     Reason            Message",
                    f"  Warning  FailedScheduling  {pod.get('reason')}",
                ]
            )
        elif str(pod.get("status", "Running")) == "CrashLoopBackOff":
            lines.extend(
                [
                    "Events:",
                    "  Type     Reason   Age   From      Message",
                    "  Warning  BackOff  20s   kubelet   Back-off restarting failed container",
                ]
            )
        else:
            lines.append("Events:          <none>")
        return "\n".join(lines)

    if resource_type == "deployments" and resource_name:
        deployment = next(
            (
                item
                for item in state["deployments"]
                if str(item.get("namespace", namespace)) == namespace
                and str(item.get("name", "")) == resource_name
            ),
            None,
        )
        if deployment is None:
            return f'Error from server (NotFound): deployments "{resource_name}" not found'
        labels = get_kubernetes_selector_labels(deployment)
        label_text = ",".join(f"{key}={value}" for key, value in labels.items()) or "<none>"
        selector_text = (
            label_text if label_text != "<none>" else f"app={deployment.get('name', 'app')}"
        )
        replicas = str(deployment.get("replicas", "1/1"))
        available, _, desired = replicas.partition("/")
        desired = desired or available or "1"
        env_entries = deployment.get("env", {}) if isinstance(deployment.get("env"), dict) else {}
        env_block = [f"      {key}:  {value}" for key, value in env_entries.items()] or [
            "      <none>"
        ]
        return "\n".join(
            [
                f"Name:                   {deployment.get('name', '')}",
                f"Namespace:              {namespace}",
                f"Labels:                 {label_text}",
                "Annotations:            deployment.kubernetes.io/revision: 1",
                f"Selector:               {selector_text}",
                f"Replicas:               {desired} desired | {desired} updated | {desired} total | {available} available | {max(int(desired) - int(available), 0)} unavailable",
                "StrategyType:           RollingUpdate",
                "MinReadySeconds:        0",
                "RollingUpdateStrategy:  25% max unavailable, 25% max surge",
                "Pod Template:",
                f"  Labels:  {selector_text}",
                "  Containers:",
                f"   {deployment.get('name', '')}:",
                f"    Image:        {deployment.get('image', 'app:latest')}",
                f"    Port:         {deployment.get('port', 80)}/TCP",
                "    Host Port:    0/TCP",
                "    Environment:",
                *env_block,
                "    Mounts:        <none>",
                "Conditions:",
                "  Type           Status  Reason",
                "  ----           ------  ------",
                f"  Available      {'True' if int(available) > 0 else 'False'}    {'MinimumReplicasAvailable' if int(available) > 0 else 'MinimumReplicasUnavailable'}",
                "  Progressing    True    NewReplicaSetAvailable",
                "OldReplicaSets:  <none>",
                f"NewReplicaSet:   {get_kubernetes_replica_set_name(str(deployment.get('name', 'app')), state['pods'], namespace)} ({available}/{desired} replicas created)",
                "Events:          <none>",
            ]
        )

    if resource_type == "services" and resource_name:
        service = next(
            (
                item
                for item in state["services"]
                if str(item.get("namespace", namespace)) == namespace
                and str(item.get("name", "")) == resource_name
            ),
            None,
        )
        if service is None:
            return f'Error from server (NotFound): services "{resource_name}" not found'
        selector_text = str(service.get("selector", f"app={service.get('name', 'app')}"))
        return "\n".join(
            [
                f"Name:              {service.get('name', '')}",
                f"Namespace:         {namespace}",
                f"Labels:            {','.join(f'{key}={value}' for key, value in service.get('labels', {}).items()) if isinstance(service.get('labels'), dict) else '<none>'}",
                "Annotations:       <none>",
                f"Selector:          {selector_text}",
                f"Type:              {service.get('type', 'ClusterIP')}",
                "IP Family Policy:  SingleStack",
                "IP Families:       IPv4",
                f"IP:                {service.get('clusterIP', '10.96.144.211')}",
                f"Port:              http  {service.get('port', 80)}/TCP",
                "TargetPort:        80/TCP",
                "Endpoints:         10.42.0.18:80",
                "Session Affinity:  None",
                "Events:            <none>",
            ]
        )

    if resource_type == "namespaces" and resource_name:
        if resource_name not in state["namespaces"]:
            return f'Error from server (NotFound): namespaces "{resource_name}" not found'
        labels = {
            "kubernetes.io/metadata.name": resource_name,
            **state["namespace_labels"].get(resource_name, {}),
        }
        return "\n".join(
            [
                f"Name:         {resource_name}",
                f"Labels:       {','.join(f'{key}={value}' for key, value in labels.items())}",
                "Status:       Active",
                "No resource quota.",
                "No LimitRange resource.",
            ]
        )

    if resource_type == "configmaps" and resource_name:
        configmap = next(
            (
                item
                for item in state["configmaps"]
                if str(item.get("namespace", namespace)) == namespace
                and str(item.get("name", "")) == resource_name
            ),
            None,
        )
        if configmap is None:
            return f'Error from server (NotFound): configmaps "{resource_name}" not found'
        data = configmap.get("data", {}) if isinstance(configmap.get("data"), dict) else {}
        lines = [f"Name:         {resource_name}", f"Namespace:    {namespace}", "Data", "===="]
        if data:
            for key, value in data.items():
                lines.extend([f"{key}:", "----", str(value)])
        else:
            lines.append("<none>")
        return "\n".join(lines)

    return None


def format_kubernetes_rollout_status_output(
    state: dict[str, object], target: dict[str, str]
) -> str:
    namespace = target["namespace"] or str(state["default_namespace"])
    resource_type = normalize_kubernetes_resource_type(target["resource_type"])
    if resource_type != "deployments":
        return f'error: rollout status is only supported for deployments, got "{target["resource_type"]}"'
    deployment = next(
        (
            item
            for item in state["deployments"]
            if str(item.get("namespace", namespace)) == namespace
            and str(item.get("name", "")) == target["resource_name"]
        ),
        None,
    )
    if deployment is None:
        return f'Error from server (NotFound): deployments "{target["resource_name"]}" not found'
    replicas = str(deployment.get("replicas", "1/1"))
    available, _, desired = replicas.partition("/")
    desired = desired or available or "1"
    if available == desired:
        return f'deployment "{target["resource_name"]}" successfully rolled out'
    return (
        f'Waiting for deployment "{target["resource_name"]}" rollout to finish: '
        f"{available} out of {desired} new replicas have been updated..."
    )


def format_kubernetes_rollout_history_output(
    state: dict[str, object], target: dict[str, str]
) -> str:
    namespace = target["namespace"] or str(state["default_namespace"])
    resource_type = normalize_kubernetes_resource_type(target["resource_type"])
    if resource_type != "deployments":
        return f'error: rollout history is only supported for deployments, got "{target["resource_type"]}"'
    deployment_name = target["resource_name"]
    deployment = next(
        (
            item
            for item in state["deployments"]
            if str(item.get("namespace", namespace)) == namespace
            and str(item.get("name", "")) == deployment_name
        ),
        None,
    )
    if deployment is None:
        return f'Error from server (NotFound): deployments "{deployment_name}" not found'
    history_entries = list(state["rollout_history"].get(deployment_name, []))
    if not history_entries:
        image = str(deployment.get("image", "unknown"))
        previous_image = deployment.get("previousImage")
        if previous_image:
            history_entries = [
                {"revision": 1, "image": previous_image},
                {"revision": 2, "image": image},
            ]
        else:
            history_entries = [{"revision": 1, "image": image}]
    rows = [f"deployment.apps/{deployment_name}", "REVISION  CHANGE-CAUSE"]
    for entry in history_entries:
        revision = int(entry.get("revision", 0))
        image = str(entry.get("image", "unknown"))
        rows.append(
            f"{revision}         kubectl set image deployment/{deployment_name} {deployment_name}={image}"
        )
    return "\n".join(rows)


def format_kubernetes_logs_output(state: dict[str, object], target: dict[str, str]) -> str:
    namespace = target["namespace"] or str(state["default_namespace"])
    pod = next(
        (
            item
            for item in state["pods"]
            if str(item.get("namespace", namespace)) == namespace
            and str(item.get("name", "")) == target["pod_name"]
        ),
        None,
    )
    if pod is None:
        return f'Error from server (NotFound): pods "{target["pod_name"]}" not found'
    if pod.get("error"):
        return str(pod["error"])
    status = str(pod.get("status", "Running"))
    if status == "CrashLoopBackOff":
        return "Error: container crashed during startup"
    return "Application started successfully"


def format_kubernetes_events_output(state: dict[str, object], target: dict[str, str | None]) -> str:
    namespace = target["namespace"] or str(state["default_namespace"])
    target_ref = target["target"]
    rows = ["LAST SEEN   TYPE      REASON    OBJECT   MESSAGE"]
    found = False
    for pod in state["pods"]:
        if str(pod.get("namespace", namespace)) != namespace:
            continue
        pod_name = str(pod.get("name", ""))
        if target_ref and target_ref not in {pod_name, f"pod/{pod_name}"}:
            continue
        status = str(pod.get("status", "Running"))
        if status == "CrashLoopBackOff":
            rows.append(
                f"20s         Warning   BackOff   pod/{pod_name}   Back-off restarting failed container"
            )
            found = True
        elif status == "ImagePullBackOff":
            message = str(pod.get("reason", pod.get("error", "Failed to pull image")))
            rows.append(f"6m          Warning   Failed    pod/{pod_name}   {message}")
            found = True
    return "\n".join(rows if found else ["No resources found."])


def format_kubernetes_get_all_output(state: dict[str, object], target: dict[str, str]) -> str:
    namespace = target["namespace"] or str(state["default_namespace"])
    pods = [item for item in state["pods"] if str(item.get("namespace", namespace)) == namespace]
    services = [
        item for item in state["services"] if str(item.get("namespace", namespace)) == namespace
    ]
    deployments = [
        item for item in state["deployments"] if str(item.get("namespace", namespace)) == namespace
    ]
    if not pods and not services and not deployments:
        return f"No resources found in {namespace} namespace."

    sections: list[str] = []
    if pods:
        pod_rows = ["NAME   READY   STATUS   RESTARTS   AGE"]
        for pod in pods:
            status = str(pod.get("status", "Running"))
            ready = "1/1" if status == "Running" else "0/1"
            pod_rows.append(
                f"pod/{str(pod.get('name', ''))}   {ready}   {status}   {str(pod.get('restarts', 0))}   {str(pod.get('age', '2d'))}"
            )
        sections.append("\n".join(pod_rows))
    if services:
        service_rows = ["NAME   TYPE   CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE"]
        for service in services:
            service_rows.append(
                f"service/{str(service.get('name', ''))}   {str(service.get('type', 'ClusterIP'))}   {str(service.get('clusterIP', '10.96.144.211'))}   <none>   {str(service.get('port', 80))}/TCP   {str(service.get('age', '10d'))}"
            )
        sections.append("\n".join(service_rows))
    if deployments:
        deployment_rows = ["NAME   READY   UP-TO-DATE   AVAILABLE   AGE"]
        for deployment in deployments:
            replicas = str(deployment.get("replicas", "1/1"))
            available, _, desired = replicas.partition("/")
            desired = desired or available or "1"
            deployment_rows.append(
                f"deployment.apps/{str(deployment.get('name', ''))}   {available}/{desired}   {desired}   {available}   {str(deployment.get('age', '2d'))}"
            )
        sections.append("\n".join(deployment_rows))
    return "\n\n".join(sections)


def format_kubernetes_top_output(state: dict[str, object], target: dict[str, str | None]) -> str:
    resource_type = equivalent_kubernetes_resource_type(str(target["resource_type"]))
    namespace = str(target["namespace"] or state["default_namespace"])
    if resource_type == "nodes":
        rows = ["NAME   CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%"]
        for node in state["nodes"]:
            cpu = str(node.get("cpu", "820m/2000m"))
            memory = str(node.get("memory", "3580Mi/4096Mi"))
            cpu_used, _, cpu_total = cpu.partition("/")
            memory_used, _, memory_total = memory.partition("/")
            cpu_percent = round((parse_milli(cpu_used) / max(parse_milli(cpu_total), 1)) * 100)
            memory_percent = round(
                (parse_mebibytes(memory_used) / max(parse_mebibytes(memory_total), 1)) * 100
            )
            rows.append(
                f"{str(node.get('name', 'node'))}   {cpu_used:<11} {cpu_percent}%    {memory_used:<14} {memory_percent}%"
            )
        return "\n".join(rows)
    if resource_type == "pods":
        pods = [
            item for item in state["pods"] if str(item.get("namespace", namespace)) == namespace
        ]
        rows = ["NAME   CPU(cores)   MEMORY(bytes)"]
        for pod in pods:
            cpu = str(pod.get("cpu", "250m"))
            memory = str(pod.get("memory", "128Mi"))
            rows.append(f"{str(pod.get('name', 'pod'))}   {cpu:<11} {memory}")
        return "\n".join(rows)
    return f'error: unsupported top resource "{target["resource_type"]}"'


def parse_milli(value: str) -> int:
    trimmed = value.strip()
    if trimmed.endswith("m"):
        return int(trimmed[:-1] or "0")
    return int(float(trimmed) * 1000)


def parse_mebibytes(value: str) -> int:
    trimmed = value.strip()
    if trimmed.endswith("Mi"):
        return int(trimmed[:-2] or "0")
    if trimmed.endswith("Gi"):
        return int(float(trimmed[:-2] or "0") * 1024)
    return int(float(trimmed or "0"))


def equivalent_kubernetes_resource_type(resource_type: str) -> str:
    aliases = {
        "namespace": "namespaces",
        "namespaces": "namespaces",
        "ns": "namespaces",
        "deployment": "deployments",
        "deployments": "deployments",
        "deploy": "deployments",
        "pod": "pods",
        "pods": "pods",
        "po": "pods",
        "service": "services",
        "services": "services",
        "svc": "services",
        "endpoint": "endpoints",
        "endpoints": "endpoints",
        "networkpolicy": "netpol",
        "networkpolicies": "netpol",
        "netpol": "netpol",
    }
    return aliases.get(resource_type, resource_type)


def matches_equivalent_kubernetes_command(normalized_input: str, normalized_candidate: str) -> bool:
    if not normalized_input.startswith("kubectl ") or not normalized_candidate.startswith(
        "kubectl "
    ):
        return False

    actual_describe = parse_kubernetes_describe_target(normalized_input)
    expected_describe = parse_kubernetes_describe_target(normalized_candidate)
    if actual_describe and expected_describe:
        return (
            equivalent_kubernetes_resource_type(str(actual_describe["resource_type"]))
            == equivalent_kubernetes_resource_type(str(expected_describe["resource_type"]))
            and actual_describe["resource_name"] == expected_describe["resource_name"]
            and actual_describe["namespace"] == expected_describe["namespace"]
        )

    actual_get = parse_kubernetes_get_target(normalized_input)
    expected_get = parse_kubernetes_get_target(normalized_candidate)
    if actual_get and expected_get:
        return (
            equivalent_kubernetes_resource_type(str(actual_get["resource_type"]))
            == equivalent_kubernetes_resource_type(str(expected_get["resource_type"]))
            and actual_get["resource_name"] == expected_get["resource_name"]
            and actual_get["namespace"] == expected_get["namespace"]
            and bool(actual_get["show_labels"]) == bool(expected_get["show_labels"])
            and actual_get.get("output_format") == expected_get.get("output_format")
        )

    actual_scale = parse_kubernetes_scale_target(normalized_input)
    expected_scale = parse_kubernetes_scale_target(normalized_candidate)
    if actual_scale and expected_scale:
        return (
            equivalent_kubernetes_resource_type(str(actual_scale["resource_type"]))
            == equivalent_kubernetes_resource_type(str(expected_scale["resource_type"]))
            and actual_scale["resource_name"] == expected_scale["resource_name"]
            and actual_scale["namespace"] == expected_scale["namespace"]
            and actual_scale["replicas"] == expected_scale["replicas"]
        )

    actual_set_image = parse_kubernetes_set_image_command(normalized_input)
    expected_set_image = parse_kubernetes_set_image_command(normalized_candidate)
    if actual_set_image and expected_set_image:
        return (
            equivalent_kubernetes_resource_type(str(actual_set_image["resource_type"]))
            == equivalent_kubernetes_resource_type(str(expected_set_image["resource_type"]))
            and actual_set_image["resource_name"] == expected_set_image["resource_name"]
            and actual_set_image["assignments"] == expected_set_image["assignments"]
        )

    actual_set_env = parse_kubernetes_set_env_command(normalized_input)
    expected_set_env = parse_kubernetes_set_env_command(normalized_candidate)
    if actual_set_env and expected_set_env:
        return (
            actual_set_env["deployment_name"] == expected_set_env["deployment_name"]
            and actual_set_env["assignments"] == expected_set_env["assignments"]
        )

    actual_rollout_status = parse_kubernetes_rollout_status_target(normalized_input)
    expected_rollout_status = parse_kubernetes_rollout_status_target(normalized_candidate)
    if actual_rollout_status and expected_rollout_status:
        return (
            equivalent_kubernetes_resource_type(str(actual_rollout_status["resource_type"]))
            == equivalent_kubernetes_resource_type(str(expected_rollout_status["resource_type"]))
            and actual_rollout_status["resource_name"] == expected_rollout_status["resource_name"]
            and actual_rollout_status["namespace"] == expected_rollout_status["namespace"]
        )

    return False


def matches_exercise_specific_equivalent_command(
    exercise: TerminalExercise,
    normalized_input: str,
    normalized_candidate: str,
) -> bool:
    if exercise.title == "Debug a Pod with Logs and Describe":
        if normalized_candidate == "kubectl logs payments-api-6d4d88fd55-rmpsv -n api":
            return normalized_input in {
                "kubectl get events -n api",
                "kubectl events --for payments-api-6d4d88fd55-rmpsv",
                "kubectl events --for pod/payments-api-6d4d88fd55-rmpsv",
            }

        if (
            normalized_candidate
            == "kubectl set env deployment/payments-api -n api APP_MODE=production"
        ):
            actual_set_env = parse_kubernetes_set_env_command(normalized_input)
            return bool(
                actual_set_env
                and actual_set_env["deployment_name"] == "payments-api"
                and dict(actual_set_env["assignments"]).get("APP_MODE") == "staging"
            )

    return False


def build_docker_images_from_history(
    exercise: TerminalExercise, history: list[dict[str, object]]
) -> list[dict[str, str]]:
    ambient_commands = parse_ambient_commands(exercise.ambient_commands)
    ambient_images = next(
        (
            ambient.response
            for ambient in ambient_commands
            if normalize_guided_exercise_command(" ".join(ambient.command.split()))
            == "docker images"
        ),
        None,
    )
    images = parse_docker_images_table(ambient_images) if ambient_images else []
    if not images:
        images = parse_images_from_world_state(exercise.world_state)

    for entry in history:
        command = str(entry["command"])
        normalized = normalize_guided_exercise_command(" ".join(command.split()))
        build_match = re.match(r"^docker build -t ([^\s]+)(?: .*)?$", normalized)
        if build_match:
            repository, tag = split_docker_image_ref(build_match.group(1))
            if not any(
                image["repository"] == repository and image["tag"] == tag for image in images
            ):
                images.append(
                    {
                        "repository": repository,
                        "tag": tag,
                        "id": "f9e8d7c6b5a4",
                        "created": "10 seconds ago",
                        "size": "142MB",
                    }
                )
            continue

        tag_match = re.match(r"^docker tag ([^\s]+) ([^\s]+)$", normalized)
        if tag_match:
            source_ref, target_ref = tag_match.groups()
            source_image = next(
                (image for image in images if docker_image_matches_ref(image, source_ref)), None
            )
            if source_image is None:
                continue
            repository, tag = split_docker_image_ref(target_ref)
            if any(image["repository"] == repository and image["tag"] == tag for image in images):
                continue
            images.append(
                {
                    "repository": repository,
                    "tag": tag,
                    "id": source_image["id"],
                    "created": source_image["created"],
                    "size": source_image["size"],
                }
            )
            continue

        if normalized.startswith("docker image prune") or normalized.startswith(
            "docker system prune"
        ):
            images = [
                image
                for image in images
                if not (image["repository"] == "<none>" and image["tag"] == "<none>")
            ]

    return images


def build_docker_containers_from_history(
    exercise: TerminalExercise, history: list[dict[str, object]]
) -> list[dict[str, object]]:
    ambient_commands = parse_ambient_commands(exercise.ambient_commands)
    ambient_containers = next(
        (
            ambient.response
            for ambient in ambient_commands
            if normalize_guided_exercise_command(" ".join(ambient.command.split()))
            == "docker ps -a"
        ),
        None,
    ) or next(
        (
            ambient.response
            for ambient in ambient_commands
            if normalize_guided_exercise_command(" ".join(ambient.command.split())) == "docker ps"
        ),
        None,
    )
    containers = (
        parse_docker_ps_table(ambient_containers)
        if ambient_containers
        else parse_containers_from_world_state(exercise.world_state)
    )

    for entry in history:
        command = str(entry["command"])
        normalized = normalize_guided_exercise_command(" ".join(command.split()))
        run_match = re.match(r"^docker run .*--name ([^\s]+).*?([a-z0-9./:_-]+)$", normalized)
        if run_match:
            name, image = run_match.groups()
            if any(container["name"] == name for container in containers):
                continue
            containers.append(
                {
                    "id": "8c1a2f5a8eb3",
                    "image": image,
                    "command": '"docker-entrypoint.sh"',
                    "status": "Up 12 seconds",
                    "ports": "",
                    "name": name,
                    "running": True,
                    "health": "healthy" if name.endswith("-fixed") else None,
                    "failing_streak": 0,
                    "logs": "Application started successfully",
                    "exit_code": 0,
                }
            )
            continue

        stop_match = re.match(r"^docker stop ([^\s]+)$", normalized)
        if stop_match:
            target = stop_match.group(1)
            for container in containers:
                if container["name"] == target or container["id"].startswith(target):
                    container["status"] = "Exited (0) just now"
                    container["running"] = False

        rm_match = re.match(r"^docker rm ([^\s]+)$", normalized)
        if rm_match:
            target = rm_match.group(1)
            containers = [
                container
                for container in containers
                if not (container["name"] == target or container["id"].startswith(target))
            ]

    return containers


def parse_docker_images_table(output: str | None) -> list[dict[str, str]]:
    if not output:
        return []
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []
    images: list[dict[str, str]] = []
    for line in lines[1:]:
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) < 5:
            continue
        repository, tag, image_id = parts[0], parts[1], parts[2]
        size = parts[-1]
        created = " ".join(parts[3:-1]) if len(parts) > 5 else parts[3]
        images.append(
            {
                "repository": repository,
                "tag": tag,
                "id": image_id,
                "created": created,
                "size": size,
            }
        )
    return images


def parse_docker_ps_table(output: str | None) -> list[dict[str, object]]:
    if not output:
        return []
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []
    containers: list[dict[str, object]] = []
    for line in lines[1:]:
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) < 5:
            continue
        container_id = parts[0]
        image = parts[1]
        command = parts[2]
        status = parts[3]
        ports = parts[4] if len(parts) > 5 else ""
        name = parts[-1]
        containers.append(
            {
                "id": container_id,
                "image": image,
                "command": command,
                "status": status,
                "ports": ports if ports != name else "",
                "name": name,
                "running": status.startswith("Up"),
            }
        )
    return containers


def parse_images_from_world_state(raw_world_state: str) -> list[dict[str, str]]:
    try:
        world_state = json.loads(raw_world_state or "{}")
    except json.JSONDecodeError:
        return []
    images = []
    for item in world_state.get("images", []):
        repository = str(item.get("repository", "")).strip()
        if not repository:
            continue
        images.append(
            {
                "repository": repository,
                "tag": str(item.get("tag", "latest")),
                "id": str(item.get("id", "unknown")),
                "created": str(item.get("created", "14 minutes ago")),
                "size": str(item.get("size", "unknown")),
            }
        )
    return images


def parse_containers_from_world_state(raw_world_state: str) -> list[dict[str, object]]:
    try:
        world_state = json.loads(raw_world_state or "{}")
    except json.JSONDecodeError:
        return []
    containers = []
    for item in world_state.get("containers", []):
        raw_status = str(item.get("status", "running"))
        health = item.get("health")
        if raw_status.lower() == "running":
            status_text = "Up 10 minutes"
            if health:
                status_text = f"{status_text} ({health})"
        elif raw_status.lower() == "exited":
            exit_code = int(item.get("exitCode", 1))
            status_text = f"Exited ({exit_code}) 2 minutes ago"
        else:
            status_text = raw_status
        containers.append(
            {
                "id": str(item.get("id", "unknown"))[:12],
                "image": str(item.get("image", "")),
                "command": str(item.get("command", '"python app.py"')),
                "status": status_text,
                "ports": str(item.get("ports", "")),
                "name": str(item.get("name", "")),
                "running": raw_status.lower() == "running" or status_text.startswith("Up"),
                "health": str(health) if health is not None else None,
                "failing_streak": int(item.get("failingStreak", 0)),
                "health_error": str(item.get("healthCheckError", item.get("healthError", ""))),
                "logs": str(item.get("logs", "")),
                "exit_code": int(item.get("exitCode", 0 if raw_status.lower() == "running" else 1)),
                "error": str(item.get("error", "")),
                "env": list(item.get("env", [])) if isinstance(item.get("env"), list) else [],
            }
        )
    return containers


def find_docker_container(
    exercise: TerminalExercise,
    history: list[dict[str, object]],
    target: str,
) -> dict[str, object] | None:
    containers = build_docker_containers_from_history(exercise, history)
    return next(
        (
            container
            for container in containers
            if container["name"] == target or str(container["id"]).startswith(target)
        ),
        None,
    )


def find_ambient_command_response(
    exercise: TerminalExercise, normalized_command: str
) -> str | None:
    for ambient in parse_ambient_commands(exercise.ambient_commands):
        candidate = normalize_guided_exercise_command(" ".join(ambient.command.split()))
        if candidate == normalized_command:
            return ambient.response
    return None


def get_world_state_file_content(world_state: dict[str, object], target: str) -> str | None:
    container_fs = world_state.get("containerFs", {})
    if isinstance(container_fs, dict) and target in container_fs:
        value = container_fs[target]
        if isinstance(value, str):
            return value
        return json.dumps(value, indent=2)
    file_contents = world_state.get("fileContents", {})
    if isinstance(file_contents, dict) and target in file_contents:
        value = file_contents[target]
        if isinstance(value, str):
            return value
        return json.dumps(value, indent=2)
    return None


def format_docker_inspect_output(
    exercise: TerminalExercise,
    normalized_command: str,
    history: list[dict[str, object]],
) -> str:
    format_match = re.match(
        r"^docker (?:container )?inspect --format=(.+) ([^\s]+)$",
        normalized_command,
    )
    if format_match:
        format_value, target = format_match.groups()
        container = find_docker_container(exercise, history, target)
        if container is None:
            return f"Error: No such object: {target}"
        if ".State.Health" in format_value:
            health = container.get("health")
            payload = {
                "Status": health or "healthy",
                "FailingStreak": int(container.get("failing_streak", 0)),
                "Log": (
                    [{"ExitCode": 127, "Output": str(container.get("health_error", ""))}]
                    if container.get("health_error")
                    else []
                ),
            }
            return json.dumps(payload, separators=(",", ":"))

    inspect_match = re.match(r"^docker (?:container )?inspect ([^\s]+)$", normalized_command)
    if not inspect_match:
        return "Error: invalid inspect command"
    target = inspect_match.group(1)
    container = find_docker_container(exercise, history, target)
    if container is None:
        return f"Error: No such object: {target}"
    state_block: dict[str, object] = {
        "Status": "running" if container.get("running") else "exited",
        "Running": bool(container.get("running")),
        "Restarting": False,
        "ExitCode": int(container.get("exit_code", 0)),
        "Error": str(container.get("error", "")),
    }
    if container.get("health") is not None:
        state_block["Health"] = {
            "Status": str(container.get("health")),
            "FailingStreak": int(container.get("failing_streak", 0)),
        }
    payload = [
        {
            "Id": str(container.get("id", "unknown")).ljust(64, "0")[:64],
            "Name": f"/{container['name']}",
            "State": state_block,
            "Config": {
                "Image": str(container.get("image", "")),
                "Env": container.get("env", []),
                "Cmd": ["python", "app.py"],
            },
        }
    ]
    return json.dumps(payload, indent=2)


def format_docker_logs_output(
    exercise: TerminalExercise,
    normalized_command: str,
    history: list[dict[str, object]],
) -> str:
    ambient_response = find_ambient_command_response(exercise, normalized_command)
    logs_match = re.match(r"^docker logs(?: --tail \d+)? ([^\s]+)$", normalized_command)
    if not logs_match:
        return ambient_response or "No logs available."
    target = logs_match.group(1)
    container = find_docker_container(exercise, history, target)
    if container is None:
        return ambient_response or f"Error: No such container: {target}"
    if (
        ambient_response
        and container["name"] == target
        and not any(
            str(entry["command"]).startswith("docker run ")
            and f"--name {target} " in str(entry["command"])
            for entry in history
        )
    ):
        return ambient_response
    if container.get("logs"):
        return str(container["logs"])
    if container.get("health_error"):
        return f"{container['health_error']}\nServer listening on :3000"
    if container.get("health") == "unhealthy":
        return "Health check failed\nServer listening on :3000"
    if str(container.get("image", "")).endswith(":v1.5"):
        return "Server started on port 9000\nWarning: running outdated version v1.5"
    return "Application started successfully"


def format_docker_exec_output(
    exercise: TerminalExercise,
    normalized_command: str,
    history: list[dict[str, object]],
) -> str | None:
    exec_match = re.match(r"^docker exec ([^\s]+) (.+)$", normalized_command)
    if not exec_match:
        return None
    target, inner_command = exec_match.groups()
    container = find_docker_container(exercise, history, target)
    if container is None:
        return f"Error response from daemon: No such container: {target}"

    world_state = parse_kubernetes_world_state(exercise.world_state)
    container_fs = world_state.get("containerFs", {})
    env = world_state.get("env", {})

    ls_match = re.match(r"^ls -la ([^\s]+)$", inner_command)
    if ls_match and isinstance(container_fs, dict):
        path = ls_match.group(1)
        entries = container_fs.get(path)
        if isinstance(entries, list):
            lines = [
                "total 16",
                "drwxr-xr-x 2 root root 4096 Apr 10 09:00 .",
                "drwxr-xr-x 1 root root 4096 Apr 10 09:00 ..",
            ]
            for entry in entries:
                lines.append(f"-rw-r--r-- 1 root root  312 Apr 10 09:00 {entry}")
            return "\n".join(lines)

    cat_match = re.match(r"^cat ([^\s]+)$", inner_command)
    if cat_match:
        content = get_world_state_file_content(world_state, cat_match.group(1))
        if content is not None:
            return content

    printenv_match = re.match(r"^printenv ([A-Za-z_][A-Za-z0-9_]*)$", inner_command)
    if printenv_match and isinstance(env, dict):
        return str(env.get(printenv_match.group(1), ""))

    return None


def format_docker_top_output(
    exercise: TerminalExercise,
    normalized_command: str,
    history: list[dict[str, object]],
) -> str | None:
    top_match = re.match(r"^docker top ([^\s]+)$", normalized_command)
    if not top_match:
        return None
    target = top_match.group(1)
    container = find_docker_container(exercise, history, target)
    if container is None:
        return f"Error response from daemon: No such container: {target}"
    if str(container.get("status", "")).startswith("Restarting") or str(
        container.get("status", "")
    ).lower().startswith("restarting"):
        return "Error response from daemon: Container is restarting, wait until the container is running"
    return "PID   USER   TIME   COMMAND\n1     root   0:00   python app.py"


def split_docker_image_ref(image_ref: str) -> tuple[str, str]:
    if ":" in image_ref:
        repository, tag = image_ref.rsplit(":", 1)
        return repository, tag
    return image_ref, "latest"


def docker_image_matches_ref(image: dict[str, str], image_ref: str | None) -> bool:
    if not image_ref:
        return True
    repository, tag = split_docker_image_ref(image_ref)
    return image["repository"] == repository and image["tag"] == tag


def format_docker_images_table(images: list[dict[str, str]]) -> str:
    header = "REPOSITORY   TAG       IMAGE ID       CREATED          SIZE"
    if not images:
        return header
    rows = [
        f"{image['repository']:<12} {image['tag']:<9} {image['id']:<14} {image['created']:<16} {image['size']}"
        for image in images
    ]
    return "\n".join([header, *rows])


def format_docker_ps_table(containers: list[dict[str, object]]) -> str:
    header = "CONTAINER ID   IMAGE              COMMAND              STATUS          PORTS                    NAMES"
    if not containers:
        return header
    rows = []
    for container in containers:
        rows.append(
            f"{str(container['id']):<14} {str(container['image']):<18} {str(container['command']):<20} "
            f"{str(container['status']):<15} {str(container['ports']):<24} {str(container['name'])}"
        )
    return "\n".join([header, *rows])


def format_docker_system_df(
    images: list[dict[str, str]], containers: list[dict[str, object]]
) -> str:
    image_total = len(images)
    image_active = len({container["image"] for container in containers if container.get("running")})
    image_size_mb = sum(size_to_mb(image["size"]) for image in images)
    image_reclaimable_mb = sum(
        size_to_mb(image["size"])
        for image in images
        if image["repository"] == "<none>" or image["tag"] == "<none>"
    )
    container_total = len(containers)
    container_active = sum(1 for container in containers if container.get("running"))
    container_size_mb = max(0, container_total * 12)
    container_reclaimable_mb = max(0, (container_total - container_active) * 12)

    return "\n".join(
        [
            "TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE",
            (
                f"Images          {image_total:<9} {image_active:<9} {format_mb(image_size_mb):<9} "
                f"{format_mb(image_reclaimable_mb)} ({percentage(image_reclaimable_mb, image_size_mb)}%)"
            ),
            (
                f"Containers      {container_total:<9} {container_active:<9} {format_mb(container_size_mb):<9} "
                f"{format_mb(container_reclaimable_mb)} ({percentage(container_reclaimable_mb, container_size_mb)}%)"
            ),
        ]
    )


def size_to_mb(size: str) -> int:
    match = re.match(r"^([0-9.]+)\s*(KB|MB|GB)$", size.strip(), re.IGNORECASE)
    if not match:
        return 0
    value = float(match.group(1))
    unit = match.group(2).upper()
    if unit == "KB":
        return max(1, round(value / 1024))
    if unit == "GB":
        return round(value * 1024)
    return round(value)


def format_mb(value: int) -> str:
    if value >= 1024:
        return f"{value / 1024:.1f}GB"
    return f"{value}MB"


def percentage(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        return 0
    return round((max(numerator, 0) / denominator) * 100)


def record_guided_exercise_history(
    exercise_id: int, command: str, output: str, valid: bool
) -> None:
    history = guided_exercise_history.setdefault(exercise_id, [])
    history.append(
        {
            "command": command,
            "output": output,
            "valid": valid,
            "timestamp": round(time() * 1000),
        }
    )
    if len(history) > 20:
        del history[:-20]
