from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.timeutils import as_utc
from app.schemas.exam import ExamPublic
from config import MAX_CODE_LENGTH


class _UtcModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_validator("started_at", "deadline", "finished_at", "server_time", check_fields=False)
    @classmethod
    def _utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return as_utc(v)


# --- Hallgatói kérések ---

class AnswerSave(BaseModel):
    """Kód / szöveg: string; választós feladat: a megjelölt indexek listája."""
    response: Any = None


class CodeRunRequest(BaseModel):
    question_id: int
    code: str = Field(max_length=MAX_CODE_LENGTH)
    custom_input: Optional[str] = Field(default=None, max_length=100_000)  # ha megadja: csak ezzel futtat


class CodeRunResponse(BaseModel):
    output: str


# --- Hallgatói nézet ---

class AnswerStudent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    question_id: int
    response: Any = None
    status: str
    eval_output: Optional[str] = None
    score: Optional[int] = None      # csak a vizsga lezárása után
    feedback: Optional[str] = None   # csak a vizsga lezárása után


class AttemptStudent(_UtcModel):
    id: int
    exam_id: int
    started_at: datetime
    deadline: datetime
    finished_at: Optional[datetime] = None
    server_time: datetime
    violations: int
    exam: ExamPublic
    answers: list[AnswerStudent] = []
    total_score: Optional[int] = None
    max_score: int
    pending_review: int = 0


class AttemptSummary(_UtcModel):
    """A hallgató saját próbálkozásai a műszerfalhoz."""
    id: int
    exam_id: int
    started_at: datetime
    deadline: datetime
    finished_at: Optional[datetime] = None
    total_score: Optional[int] = None
    max_score: int
    pending_review: int = 0


# --- Oktatói nézet ---

class AnswerTeacher(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    response: Any = None
    auto_score: Optional[int] = None
    manual_score: Optional[int] = None
    score: int
    feedback: Optional[str] = None
    eval_output: Optional[str] = None
    status: str


class StudentInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str


class AttemptTeacher(_UtcModel):
    id: int
    user: StudentInfo
    started_at: datetime
    deadline: datetime
    finished_at: Optional[datetime] = None
    violations: int
    total_score: int
    max_score: int
    pending_review: int
    answers: list[AnswerTeacher] = []


class GradeRequest(BaseModel):
    manual_score: Optional[int] = Field(default=None, ge=0)  # None = vissza az automatikus pontra
    feedback: Optional[str] = Field(default=None, max_length=10_000)
