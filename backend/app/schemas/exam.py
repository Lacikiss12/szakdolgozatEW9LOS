from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.timeutils import as_utc

QuestionType = Literal["code", "single_choice", "multiple_choice", "true_false", "short_text", "essay"]

TRUE_FALSE_OPTIONS = ["Igaz", "Hamis"]


# --- Feladat (Question) sémák ---

class CodeTestCase(BaseModel):
    input: str = ""
    expected_output: str = ""
    public: bool = False  # a hallgató látja-e (példateszt) – a többi rejtett

    @field_validator("input", "expected_output", mode="before")
    @classmethod
    def _to_str(cls, v: Any) -> str:
        return "" if v is None else str(v)


class QuestionCreate(BaseModel):
    type: QuestionType = "code"
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    points: int = Field(default=10, ge=1, le=1000)
    options: Optional[list[str]] = None
    answer_key: Optional[Any] = None

    @model_validator(mode="after")
    def _validate_by_type(self):
        """Típusonként ellenőrzi és egységes formára hozza a válaszlehetőségeket és a megoldókulcsot."""
        t = self.type

        def indices(min_count: int, max_count: int) -> list[int]:
            key = self.answer_key
            if isinstance(key, int):
                key = [key]
            if not isinstance(key, list) or not all(isinstance(i, int) for i in key):
                raise ValueError("A megoldókulcs a helyes válaszok indexeinek listája legyen.")
            key = sorted(set(key))
            if not (min_count <= len(key) <= max_count):
                raise ValueError("Jelölj meg helyes választ (egyválasztósnál pontosan egyet).")
            if any(i < 0 or i >= len(self.options) for i in key):
                raise ValueError("A megoldókulcs nem létező válaszlehetőségre hivatkozik.")
            return key

        if t in ("single_choice", "multiple_choice"):
            opts = [o.strip() for o in (self.options or []) if o and o.strip()]
            if len(opts) < 2:
                raise ValueError("Legalább két (nem üres) válaszlehetőség kell.")
            self.options = opts
            self.answer_key = indices(1, 1 if t == "single_choice" else len(opts))
        elif t == "true_false":
            self.options = list(TRUE_FALSE_OPTIONS)
            self.answer_key = indices(1, 1)
        elif t == "short_text":
            key = self.answer_key
            if isinstance(key, str):
                key = [key]
            key = [str(a).strip() for a in (key or []) if str(a).strip()]
            if not key:
                raise ValueError("Adj meg legalább egy elfogadott választ.")
            self.options, self.answer_key = None, key
        elif t == "essay":
            self.options, self.answer_key = None, None
        elif t == "code":
            tests = self.answer_key or []
            if not isinstance(tests, list):
                raise ValueError("A tesztesetek listája legyen.")
            self.options = None
            self.answer_key = [CodeTestCase.model_validate(x).model_dump() for x in tests]
        return self


class QuestionPublic(BaseModel):
    """A hallgató ezt látja – megoldókulcs NÉLKÜL."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    exam_id: int
    position: int
    type: str
    title: str
    description: str
    points: int
    options: Optional[list[str]] = None
    public_tests: list[dict] = []


class QuestionTeacher(QuestionPublic):
    """Oktatói nézet – a megoldókulccsal együtt."""
    answer_key: Optional[Any] = None


# --- Vizsga (Exam) sémák ---

class ExamCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    duration_minutes: int = Field(ge=1, le=24 * 60)
    start_time: datetime
    end_time: datetime

    @field_validator("start_time", "end_time")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return as_utc(v)

    @model_validator(mode="after")
    def _check_window(self):
        if self.end_time <= self.start_time:
            raise ValueError("A vizsga végének a kezdés után kell lennie.")
        return self


class ExamSummary(BaseModel):
    """Vizsgalista elem – feladatok nélkül (a hallgató csak kezdés után látja őket)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: Optional[str] = None
    duration_minutes: int
    start_time: datetime
    end_time: datetime
    created_by: int
    question_count: int = 0
    total_points: int = 0

    @field_validator("start_time", "end_time")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return as_utc(v)


class ExamTeacher(ExamSummary):
    questions: list[QuestionTeacher] = []


class ExamPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: Optional[str] = None
    duration_minutes: int
    questions: list[QuestionPublic] = []
