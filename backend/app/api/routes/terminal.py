from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.terminal import (
    ExerciseCommandRequest,
    ExerciseCommandResponse,
    ResetResponse,
    TerminalExecRequest,
    TerminalExecResponse,
    TerminalExerciseRead,
)
from backend.app.services.terminal import (
    execute_terminal_command,
    get_exercise,
    list_exercises,
    reset_exercise,
    run_exercise_command,
)


# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
router = APIRouter(tags=["terminal"])


def parse_exercise_id(raw_value: str) -> int | JSONResponse:
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return JSONResponse(status_code=404, content={"error": "Exercise not found"})


@router.get("/exercises", response_model=list[TerminalExerciseRead])
async def get_exercises(
    db: Annotated[Session, Depends(get_db)],
    track: Annotated[str | None, Query()] = None,
) -> list[TerminalExerciseRead]:
    return list_exercises(db, track=track)


@router.get("/exercises/{exercise_id}", response_model=TerminalExerciseRead)
async def get_exercise_by_id(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> TerminalExerciseRead:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    exercise = get_exercise(db, parsed_exercise_id)
    if exercise is None:
        return JSONResponse(status_code=404, content={"error": "Exercise not found"})
    return exercise


@router.post("/exercises/{exercise_id}/command", response_model=ExerciseCommandResponse)
async def post_exercise_command(
    exercise_id: str,
    payload: ExerciseCommandRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ExerciseCommandResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    result = run_exercise_command(db, parsed_exercise_id, payload.command)
    if result is None:
        return JSONResponse(status_code=404, content={"error": "Exercise not found"})
    return result


@router.post("/exercises/{exercise_id}/reset", response_model=ResetResponse)
async def post_exercise_reset(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ResetResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    ok = reset_exercise(db, parsed_exercise_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": "Exercise not found"})
    return ResetResponse()


@router.post("/terminal/exec", response_model=TerminalExecResponse)
async def post_terminal_exec(
    payload: TerminalExecRequest,
) -> TerminalExecResponse:
    if not payload.command or not isinstance(payload.command, str):
        return JSONResponse(status_code=400, content={"error": "command is required"})
    result = execute_terminal_command(payload.command)
    return TerminalExecResponse(**result)
