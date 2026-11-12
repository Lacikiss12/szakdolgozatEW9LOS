from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.timeutils import utcnow


# Feladattípusok
QUESTION_TYPES = ("code", "single_choice", "multiple_choice", "true_false", "short_text", "essay")

# Válasz állapotok
STATUS_NOT_GRADED = "not_graded"        # még nincs értékelve (pl. mentett, de be nem adott kód)
STATUS_GRADED = "graded"                # automatikusan vagy kézzel értékelve
STATUS_PENDING_REVIEW = "pending_review"  # oktatói javításra vár (esszé)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="student", nullable=False)  # "student" vagy "teacher"

    exams_created = relationship("Exam", back_populates="creator")
    attempts = relationship("Attempt", back_populates="user")


class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    duration_minutes = Column(Integer, nullable=False)  # egy hallgató ennyi ideig dolgozhat
    start_time = Column(DateTime(timezone=True), nullable=False)  # ettől lehet elkezdeni
    end_time = Column(DateTime(timezone=True), nullable=False)    # eddig lehet elkezdeni / beadni
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    creator = relationship("User", back_populates="exams_created")
    questions = relationship("Question", back_populates="exam", cascade="all, delete-orphan",
                             order_by="Question.position, Question.id")
    attempts = relationship("Attempt", back_populates="exam", cascade="all, delete-orphan")

    @property
    def question_count(self) -> int:
        return len(self.questions)

    @property
    def total_points(self) -> int:
        return sum(q.points for q in self.questions)


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    position = Column(Integer, default=0, nullable=False)
    type = Column(String, default="code", nullable=False)  # lásd QUESTION_TYPES
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    points = Column(Integer, default=10, nullable=False)
    # Választós feladatok válaszlehetőségei: ["A", "B", "C"]
    options = Column(JSON, nullable=True)
    # Megoldókulcs – a hallgató SOHA nem kapja meg. Típusonként:
    #   code:            [{"input": "2 3", "expected_output": "5", "public": true}, ...]
    #   single_choice / true_false / multiple_choice: [helyes indexek]
    #   short_text:      ["elfogadott válasz", ...]
    #   essay:           null (kézi javítás)
    answer_key = Column(JSON, nullable=True)

    exam = relationship("Exam", back_populates="questions")
    answers = relationship("Answer", back_populates="question", cascade="all, delete-orphan")

    @property
    def public_tests(self) -> list[dict]:
        """Kódfeladatnál a hallgatónak is megmutatható (nyilvános) példatesztek."""
        if self.type != "code" or not isinstance(self.answer_key, list):
            return []
        return [{"input": t.get("input", ""), "expected_output": t.get("expected_output", "")}
                for t in self.answer_key if isinstance(t, dict) and t.get("public")]


class Attempt(Base):
    """Egy hallgató egy vizsgán (vizsgánként és hallgatónként legfeljebb egy)."""
    __tablename__ = "attempts"
    __table_args__ = (UniqueConstraint("user_id", "exam_id", name="uq_attempt_user_exam"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    deadline = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    violations = Column(Integer, default=0, nullable=False)  # proctoring események száma

    user = relationship("User", back_populates="attempts")
    exam = relationship("Exam", back_populates="attempts")
    answers = relationship("Answer", back_populates="attempt", cascade="all, delete-orphan")


class Answer(Base):
    """Egy feladatra adott válasz és annak értékelése."""
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_answer_attempt_question"),)

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("attempts.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    # code / short_text / essay: str;  választós: list[int]
    response = Column(JSON, nullable=True)
    auto_score = Column(Integer, nullable=True)
    manual_score = Column(Integer, nullable=True)  # ha az oktató felülírta / kézzel pontozta
    feedback = Column(Text, nullable=True)
    eval_output = Column(Text, nullable=True)  # a kódértékelés (hallgatónak is mutatható) kimenete
    status = Column(String, default=STATUS_NOT_GRADED, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    attempt = relationship("Attempt", back_populates="answers")
    question = relationship("Question", back_populates="answers")

    @property
    def score(self) -> int:
        if self.manual_score is not None:
            return self.manual_score
        return self.auto_score or 0
