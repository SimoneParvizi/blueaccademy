from pydantic import BaseModel, ConfigDict, Field


class CkadProgressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    exercise_id: int = Field(alias="exerciseId")
    passed: bool
    attempts: int
    last_attempt_at: int | None = Field(alias="lastAttemptAt")
    last_result: str | None = Field(alias="lastResult")


class CkadExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    number: int
    title: str
    mode: str
    track: str
    domain: str
    difficulty: str
    time_minutes: int = Field(alias="timeMinutes")
    scenario: str
    hints: str
    solution: str
    validations: str
    cleanup: str
    progress: CkadProgressRead | None = None


class ValidationResultRead(BaseModel):
    description: str
    passed: bool
    output: str
    expected: str | None = None


class ValidationResponse(BaseModel):
    passed: bool
    results: list[ValidationResultRead]


class CleanupResponse(BaseModel):
    cleaned: list[str]
