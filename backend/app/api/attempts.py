"""Hallgatói vizsgafolyamat: indítás → válaszok mentése / kód futtatása → beadás."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.exams import get_exam_or_404
from app.core.database import get_db
from app.core.timeutils import as_utc, utcnow
from app.models.models import Attempt, Question, STATUS_GRADED, STATUS_NOT_GRADED, User
from app.schemas.exam import ExamPublic
from app.schemas.submission import (
    AnswerSave, AnswerStudent, AttemptStudent, AttemptSummary, CodeRunRequest, CodeRunResponse,
)
from app.services import grading

router = APIRouter(tags=["Attempts (hallgatói vizsgafolyamat)"])


def require_student(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Vizsgát csak hallgatói fiókkal lehet kitölteni.")
    return current_user


def student_view(attempt: Attempt) -> AttemptStudent:
    finished = attempt.finished_at is not None
    answers = [
        AnswerStudent(
            question_id=a.question_id,
            response=a.response,
            status=a.status,
            eval_output=a.eval_output if a.question.type == "code" else None,
            score=a.score if finished and a.status == STATUS_GRADED else None,
            feedback=a.feedback if finished else None,
        )
        for a in attempt.answers
    ]
    return AttemptStudent(
        id=attempt.id,
        exam_id=attempt.exam_id,
        started_at=attempt.started_at,
        deadline=attempt.deadline,
        finished_at=attempt.finished_at,
        server_time=utcnow(),
        violations=attempt.violations,
        exam=ExamPublic.model_validate(attempt.exam),
        answers=answers,
        total_score=grading.total_score(attempt) if finished else None,
        max_score=grading.max_score(attempt),
        pending_review=grading.pending_review(attempt) if finished else 0,
    )


def _find_attempt(db: Session, exam_id: int, user: User) -> Attempt | None:
    return db.query(Attempt).filter(Attempt.exam_id == exam_id, Attempt.user_id == user.id).first()


def _own_attempt(db: Session, attempt_id: int, user: User) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if not attempt or attempt.user_id != user.id:
        raise HTTPException(status_code=404, detail="A vizsgakitöltés nem található.")
    return attempt


def _active_attempt(db: Session, attempt_id: int, user: User) -> Attempt:
    attempt = _own_attempt(db, attempt_id, user)
    if not grading.is_active(attempt):
        grading.finalize_if_expired(db, attempt)
        raise HTTPException(status_code=409, detail="A vizsga már le van zárva (beadva vagy lejárt az idő).")
    return attempt


def _question_of(attempt: Attempt, question_id: int) -> Question:
    for q in attempt.exam.questions:
        if q.id == question_id:
            return q
    raise HTTPException(status_code=404, detail="A feladat nem tartozik ehhez a vizsgához.")


# --- Végpontok ---

@router.post("/exams/{exam_id}/attempt", response_model=AttemptStudent)
def start_or_resume(exam_id: int, db: Session = Depends(get_db), user: User = Depends(require_student)):
    """Elkezdi a vizsgát (ha még nem kezdte el), vagy visszaadja a folyamatban lévőt.
    A rendelkezésre álló idő: min(vizsga vége, kezdés + időtartam)."""
    exam = get_exam_or_404(db, exam_id)
    attempt = _find_attempt(db, exam_id, user)
    if attempt is None:
        now = utcnow()
        start, end = as_utc(exam.start_time), as_utc(exam.end_time)
        if now < start:
            raise HTTPException(status_code=403, detail="A vizsga még nem kezdődött el.")
        if now >= end:
            raise HTTPException(status_code=403, detail="A vizsga már lezárult, nem lehet elkezdeni.")
        if not exam.questions:
            raise HTTPException(status_code=403, detail="Ehhez a vizsgához még nincs feladat rendelve.")
        attempt = Attempt(user_id=user.id, exam_id=exam_id, started_at=now,
                          deadline=min(end, now + timedelta(minutes=exam.duration_minutes)))
        db.add(attempt)
        try:
            db.commit()
        except IntegrityError:  # párhuzamos kérés már létrehozta
            db.rollback()
            attempt = _find_attempt(db, exam_id, user)
            if attempt is None:  # nem párhuzamosság volt, hanem valódi adatbázishiba
                raise
        db.refresh(attempt)
    grading.finalize_if_expired(db, attempt)
    return student_view(attempt)


@router.get("/exams/{exam_id}/attempt", response_model=AttemptStudent)
def get_my_attempt(exam_id: int, db: Session = Depends(get_db), user: User = Depends(require_student)):
    """A saját kitöltés megtekintése (eredménnyel, ha már lezárult) – nem indítja el a vizsgát."""
    attempt = _find_attempt(db, exam_id, user)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Ezt a vizsgát még nem kezdted el.")
    grading.finalize_if_expired(db, attempt)
    return student_view(attempt)


@router.get("/attempts/me", response_model=list[AttemptSummary])
def my_attempts(db: Session = Depends(get_db), user: User = Depends(require_student)):
    result = []
    for attempt in db.query(Attempt).filter(Attempt.user_id == user.id).all():
        grading.finalize_if_expired(db, attempt)
        finished = attempt.finished_at is not None
        result.append(AttemptSummary(
            id=attempt.id, exam_id=attempt.exam_id, started_at=attempt.started_at,
            deadline=attempt.deadline, finished_at=attempt.finished_at,
            total_score=grading.total_score(attempt) if finished else None,
            max_score=grading.max_score(attempt),
            pending_review=grading.pending_review(attempt) if finished else 0,
        ))
    return result


@router.put("/attempts/{attempt_id}/answers/{question_id}", response_model=AnswerStudent)
def save_answer(attempt_id: int, question_id: int, body: AnswerSave,
                db: Session = Depends(get_db), user: User = Depends(require_student)):
    """Válasz mentése (automatikus mentés). Értékelés csak beadáskor (kódnál a 'Beküldés' gombbal)."""
    attempt = _active_attempt(db, attempt_id, user)
    question = _question_of(attempt, question_id)
    try:
        response = grading.validate_response(question, body.response)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    answer = grading.get_or_create_answer(db, attempt, question)
    if answer.response != response:
        answer.response = response
        answer.status = STATUS_NOT_GRADED
        answer.auto_score = None
    db.commit()
    return AnswerStudent(question_id=question.id, response=answer.response, status=answer.status,
                         eval_output=answer.eval_output if question.type == "code" else None)


@router.post("/attempts/{attempt_id}/answers/{question_id}/evaluate", response_model=AnswerStudent)
def evaluate_code_answer(attempt_id: int, question_id: int, body: AnswerSave,
                         db: Session = Depends(get_db), user: User = Depends(require_student)):
    """Kódfeladat beküldése: mentés + kiértékelés az összes (nyilvános és rejtett) tesztesettel."""
    attempt = _active_attempt(db, attempt_id, user)
    question = _question_of(attempt, question_id)
    if question.type != "code":
        raise HTTPException(status_code=400, detail="Csak kódfeladat értékelhető azonnal.")
    try:
        response = grading.validate_response(question, body.response)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    answer = grading.get_or_create_answer(db, attempt, question)
    answer.response = response
    grading.apply_grade(answer, grading.grade_answer(question, response))
    db.commit()
    return AnswerStudent(question_id=question.id, response=answer.response, status=answer.status,
                         eval_output=answer.eval_output)


@router.post("/attempts/{attempt_id}/run", response_model=CodeRunResponse)
def run_code(attempt_id: int, body: CodeRunRequest, db: Session = Depends(get_db),
             user: User = Depends(require_student)):
    """Próbafuttatás: saját bemenettel vagy a nyilvános példatesztekkel. Nem ment, nem pontoz."""
    attempt = _active_attempt(db, attempt_id, user)
    question = _question_of(attempt, body.question_id)
    if question.type != "code":
        raise HTTPException(status_code=400, detail="Ez nem kódfeladat.")
    return CodeRunResponse(output=grading.run_code_preview(question, body.code, body.custom_input))


@router.post("/attempts/{attempt_id}/finish", response_model=AttemptStudent)
def finish_attempt(attempt_id: int, db: Session = Depends(get_db), user: User = Depends(require_student)):
    """Végleges beadás: minden válasz értékelése, utána már nem módosítható."""
    attempt = _own_attempt(db, attempt_id, user)
    grading.finalize_attempt(db, attempt)
    return student_view(attempt)
