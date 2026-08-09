from pydantic import BaseModel, ConfigDict, Field


class ExerciseProgressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    exercise_id: int = Field(alias="exerciseId")
    completed: bool
    completed_at: int | None = Field(alias="completedAt")
    attempts: int


class TerminalExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    title: str
    description: str
    track: str
    difficulty: str
    scenario: str
    objectives: str
    valid_commands: str = Field(alias="validCommands")
    initial_output: str = Field(alias="initialOutput")
    completion_message: str = Field(alias="completionMessage")
    progress: ExerciseProgressRead | None = None


class ExerciseCommandRequest(BaseModel):
    command: str


class ExerciseCommandResponse(BaseModel):
    output: str
    valid: bool
    completes: bool
    completion_message: str | None = Field(default=None, alias="completionMessage")
    matched_command: str | None = Field(default=None, alias="matchedCommand")


class ResetResponse(BaseModel):
    ok: bool = True


class TerminalExecRequest(BaseModel):
    command: str


class TerminalExecResponse(BaseModel):
    stdout: str
    stderr: str
    exitCode: int
