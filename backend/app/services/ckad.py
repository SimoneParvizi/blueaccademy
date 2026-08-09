import json
import os
import shlex
import subprocess
import tempfile
from time import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.orm.ckad_exercise import CkadExercise
from backend.app.db.orm.ckad_progress import CkadProgress
from backend.app.db.orm.cluster_server import ClusterServer
from backend.app.db.orm.kubeconfig import Kubeconfig
from backend.app.services.infra.ssh import run_remote_command
from backend.app.services.terminal import terminal_home, terminal_workspace


def list_ckad_exercises(db: Session) -> list[dict]:
    exercises = list(
        db.scalars(
            select(CkadExercise)
            .where(CkadExercise.mode == "ckad")
            .order_by(CkadExercise.number.asc(), CkadExercise.id.asc())
        ).all()
    )
    return [serialize_exercise(db, exercise) for exercise in exercises]


def get_ckad_exercise(db: Session, exercise_id: int) -> dict | None:
    exercise = db.scalar(
        select(CkadExercise).where(CkadExercise.id == exercise_id, CkadExercise.mode == "ckad")
    )
    if exercise is None:
        return None
    return serialize_exercise(db, exercise)


def list_real_env_exercises(db: Session) -> list[dict]:
    exercises = list(
        db.scalars(
            select(CkadExercise)
            .where(CkadExercise.mode == "e2e")
            .order_by(CkadExercise.number.asc(), CkadExercise.id.asc())
        ).all()
    )
    return [serialize_exercise(db, exercise) for exercise in exercises]


def get_real_env_exercise(db: Session, exercise_id: int) -> dict | None:
    exercise = db.scalar(
        select(CkadExercise).where(CkadExercise.id == exercise_id, CkadExercise.mode == "e2e")
    )
    if exercise is None:
        return None
    return serialize_exercise(db, exercise)


def get_ckad_progress(db: Session, exercise_id: int) -> CkadProgress | None:
    return db.scalar(select(CkadProgress).where(CkadProgress.exercise_id == exercise_id))


def upsert_ckad_progress(
    db: Session,
    exercise_id: int,
    *,
    passed: bool,
    attempts: int,
    last_attempt_at: int,
    last_result: str,
) -> CkadProgress:
    progress = get_ckad_progress(db, exercise_id)
    if progress is None:
        progress = CkadProgress(
            exercise_id=exercise_id,
            passed=passed,
            attempts=attempts,
            last_attempt_at=last_attempt_at,
            last_result=last_result,
        )
        db.add(progress)
    else:
        progress.passed = passed
        progress.attempts = attempts
        progress.last_attempt_at = last_attempt_at
        progress.last_result = last_result
    db.commit()
    db.refresh(progress)
    return progress


def split_kubectl_args(command: str) -> list[str]:
    stripped = command.strip()
    if stripped.startswith("kubectl "):
        stripped = stripped[len("kubectl ") :]
    elif stripped == "kubectl":
        stripped = ""
    return shlex.split(stripped)


def evaluate_validation(output: str, ok: bool, validation: dict) -> bool:
    if "expectedValue" in validation:
        return output == validation["expectedValue"]
    if "mustContain" in validation:
        return validation["mustContain"] in output
    if "mustNotContain" in validation:
        return validation["mustNotContain"] not in output
    return ok


def parse_json_steps(raw: str) -> list:
    try:
        payload = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return payload if isinstance(payload, list) else []


def run_kubectl_command(db: Session, args: list[str]) -> dict[str, object]:
    active = db.scalar(select(Kubeconfig).where(Kubeconfig.active.is_(True)))
    tmp_file = None
    try:
        if active is not None:
            handle = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=".yaml",
                prefix="kube-active-",
                delete=False,
            )
            handle.write(active.content)
            handle.flush()
            handle.close()
            tmp_file = handle.name
        command = ["kubectl"]
        if tmp_file:
            command.extend(["--kubeconfig", tmp_file])
        command.extend(args)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=15,
            env=dict(os.environ),
            check=False,
        )
        return {
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "ok": result.returncode == 0,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "kubectl command timed out",
            "ok": False,
        }
    finally:
        if tmp_file:
            try:
                os.unlink(tmp_file)
            except OSError:
                pass


def run_local_shell_command(command: str, cwd: str | None = None) -> dict[str, object]:
    env = dict(os.environ)
    env["HOME"] = terminal_home
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=cwd or terminal_workspace,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "Command timed out",
            "ok": False,
        }
    return {
        "stdout": result.stdout or "",
        "stderr": result.stderr or "",
        "ok": result.returncode == 0,
    }


def get_ready_cluster_server_for_real_env(db: Session) -> ClusterServer | None:
    return db.scalar(
        select(ClusterServer)
        .where(
            ClusterServer.status == "ready",
            ClusterServer.server_ip.is_not(None),
            ClusterServer.ssh_private_key.is_not(None),
        )
        .order_by(ClusterServer.id.asc())
    )


async def run_real_env_shell_command(db: Session, command: str) -> dict[str, object]:
    server = get_ready_cluster_server_for_real_env(db)
    if server is None or not server.server_ip or not server.ssh_private_key:
        return {
            "stdout": "",
            "stderr": "No ready cluster server is available for real-environment execution.",
            "ok": False,
        }

    try:
        result = await run_remote_command(
            server.server_ip, server.ssh_private_key, command, timeout_ms=30_000
        )
        return {
            "stdout": result["stdout"] or "",
            "stderr": result["stderr"] or "",
            "ok": result["code"] == 0,
        }
    except Exception as exc:  # pragma: no cover - network/runtime failure parity
        return {
            "stdout": "",
            "stderr": str(exc) or "Remote shell execution failed.",
            "ok": False,
        }


async def validate_exercise(
    db: Session, exercise: CkadExercise, *, shell_runner: str
) -> dict[str, object]:
    validations = parse_json_steps(exercise.validations)
    results: list[dict[str, object]] = []

    for validation in validations:
        runner = validation.get("runner", "kubectl")
        if runner == "shell":
            if shell_runner == "remote":
                result = await run_real_env_shell_command(db, validation["command"])
            else:
                result = run_local_shell_command(validation["command"], validation.get("cwd"))
        else:
            result = run_kubectl_command(db, split_kubectl_args(validation["command"]))

        output = f"{result['stdout']}{result['stderr']}".strip()
        passed = evaluate_validation(output, bool(result["ok"]), validation)
        results.append(
            {
                "description": validation["description"],
                "passed": passed,
                "output": output,
                "expected": validation.get("expectedValue") or validation.get("mustContain"),
            }
        )

    all_passed = all(result["passed"] for result in results)
    progress = get_ckad_progress(db, exercise.id)
    upsert_ckad_progress(
        db,
        exercise.id,
        passed=all_passed,
        attempts=(progress.attempts if progress else 0) + 1,
        last_attempt_at=round(time() * 1000),
        last_result=json.dumps(results),
    )
    return {"passed": all_passed, "results": results}


async def cleanup_exercise(
    db: Session, exercise: CkadExercise, *, shell_runner: str
) -> dict[str, object]:
    done: list[str] = []
    for step in parse_json_steps(exercise.cleanup):
        if isinstance(step, str):
            run_kubectl_command(db, split_kubectl_args(step))
            done.append(step)
            continue

        runner = step.get("runner", "kubectl")
        if runner == "shell":
            if shell_runner == "remote":
                await run_real_env_shell_command(db, step["command"])
            else:
                run_local_shell_command(step["command"], step.get("cwd"))
        else:
            run_kubectl_command(db, split_kubectl_args(step["command"]))
        done.append(step["command"])
    return {"cleaned": done}


def serialize_exercise(db: Session, exercise: CkadExercise) -> dict:
    progress = get_ckad_progress(db, exercise.id)
    return {
        "id": exercise.id,
        "number": exercise.number,
        "title": exercise.title,
        "mode": exercise.mode,
        "track": exercise.track,
        "domain": exercise.domain,
        "difficulty": exercise.difficulty,
        "timeMinutes": exercise.time_minutes,
        "scenario": exercise.scenario,
        "hints": exercise.hints,
        "solution": exercise.solution,
        "validations": exercise.validations,
        "cleanup": exercise.cleanup,
        "progress": (
            {
                "id": progress.id,
                "exerciseId": progress.exercise_id,
                "passed": progress.passed,
                "attempts": progress.attempts,
                "lastAttemptAt": progress.last_attempt_at,
                "lastResult": progress.last_result,
            }
            if progress is not None
            else None
        ),
    }
