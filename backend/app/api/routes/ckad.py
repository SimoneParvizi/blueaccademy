from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

<<<<<<< Updated upstream
from backend.app.db.session import get_db
from backend.app.db.orm.ckad_exercise import CkadExercise
from backend.app.schemas.ckad import CleanupResponse, CkadExerciseRead, ValidationResponse
=======
from backend.app.db.orm.ckad_exercise import CkadExercise
from backend.app.db.session import get_db
from backend.app.schemas.ckad import CkadExerciseRead, CleanupResponse, ValidationResponse
>>>>>>> Stashed changes
from backend.app.services.ckad import (
    cleanup_exercise,
    get_ckad_exercise,
    get_real_env_exercise,
    list_ckad_exercises,
    list_real_env_exercises,
    validate_exercise,
)


# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
router = APIRouter(tags=["ckad"])


def parse_exercise_id(raw_value: str) -> int | JSONResponse:
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return JSONResponse(status_code=404, content={"error": "Not found"})


def get_exercise_model_or_404(db: Session, exercise_id: int, *, mode: str) -> CkadExercise:
    exercise = db.get(CkadExercise, exercise_id)
    if exercise is None or exercise.mode != mode:
        raise LookupError("Not found")
    return exercise


@router.get("/ckad/exercises", response_model=list[CkadExerciseRead])
async def get_ckad_exercises_route(
    db: Annotated[Session, Depends(get_db)],
) -> list[CkadExerciseRead]:
    return list_ckad_exercises(db)


@router.get("/ckad/exercises/{exercise_id}", response_model=CkadExerciseRead)
async def get_ckad_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> CkadExerciseRead:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    exercise = get_ckad_exercise(db, parsed_exercise_id)
    if exercise is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return exercise


@router.post("/ckad/exercises/{exercise_id}/validate", response_model=ValidationResponse)
async def validate_ckad_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ValidationResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    try:
        model = get_exercise_model_or_404(db, parsed_exercise_id, mode="ckad")
    except LookupError:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return await validate_exercise(db, model, shell_runner="local")


@router.post("/ckad/exercises/{exercise_id}/cleanup", response_model=CleanupResponse)
async def cleanup_ckad_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> CleanupResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    try:
        model = get_exercise_model_or_404(db, parsed_exercise_id, mode="ckad")
    except LookupError:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return await cleanup_exercise(db, model, shell_runner="local")


@router.get("/real-env/exercises", response_model=list[CkadExerciseRead])
async def get_real_env_exercises_route(
    db: Annotated[Session, Depends(get_db)],
) -> list[CkadExerciseRead]:
    return list_real_env_exercises(db)


@router.get("/real-env/exercises/{exercise_id}", response_model=CkadExerciseRead)
async def get_real_env_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> CkadExerciseRead:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    exercise = get_real_env_exercise(db, parsed_exercise_id)
    if exercise is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return exercise


@router.post("/real-env/exercises/{exercise_id}/validate", response_model=ValidationResponse)
async def validate_real_env_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ValidationResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    try:
        model = get_exercise_model_or_404(db, parsed_exercise_id, mode="e2e")
    except LookupError:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return await validate_exercise(db, model, shell_runner="remote")


@router.post("/real-env/exercises/{exercise_id}/cleanup", response_model=CleanupResponse)
async def cleanup_real_env_exercise_route(
    exercise_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> CleanupResponse:
    parsed_exercise_id = parse_exercise_id(exercise_id)
    if isinstance(parsed_exercise_id, JSONResponse):
        return parsed_exercise_id
    try:
        model = get_exercise_model_or_404(db, parsed_exercise_id, mode="e2e")
    except LookupError:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return await cleanup_exercise(db, model, shell_runner="remote")
