"""Oktatói nézet: eredmények, kézi javítás (esszé / pontfelülírás), CSV export."""
import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.exams import get_owned_exam, require_teacher
from app.core.database import get_db
from app.core.timeutils import as_utc
from app.models.models import Answer, Attempt, STATUS_GRADED, STATUS_NOT_GRADED, STATUS_PENDING_REVIEW, User
from app.schemas.submission import AnswerTeacher, AttemptTeacher, GradeRequest, StudentInfo
from app.services import grading

router = APIRouter(tags=["Results (oktatói értékelés)"])


def _teacher_view(attempt: Attempt) -> AttemptTeacher:
    order = {q.id: i for i, q in enumerate(attempt.exam.questions)}
    answers = sorted(attempt.answers, key=lambda a: order.get(a.question_id, 0))
    return AttemptTeacher(
        id=attempt.id,
        user=StudentInfo.model_validate(attempt.user),
        started_at=attempt.started_at,
        deadline=attempt.deadline,
        finished_at=attempt.finished_at,
        violations=attempt.violations,
        total_score=grading.total_score(attempt),
        max_score=grading.max_score(attempt),
        pending_review=grading.pending_review(attempt),
        answers=[AnswerTeacher.model_validate(a) for a in answers],
    )


def _attempts(db: Session, exam_id: int) -> list[Attempt]:
    attempts = (db.query(Attempt).join(User).filter(Attempt.exam_id == exam_id)
                .order_by(User.full_name).all())
    for a in attempts:
        grading.finalize_if_expired(db, a)  # lejárt, de be nem adott kitöltések lezárása
    return attempts


@router.get("/exams/{exam_id}/results", response_model=list[AttemptTeacher])
def exam_results(exam_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    get_owned_exam(db, exam_id, teacher)
    return [_teacher_view(a) for a in _attempts(db, exam_id)]


@router.get("/exams/{exam_id}/results.csv")
def exam_results_csv(exam_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    exam = get_owned_exam(db, exam_id, teacher)
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")  # a magyar Excel pontosvesszőt vár
    writer.writerow(["Név", "E-mail", "Kezdés", "Beadás", "Ablakváltások",
                     *[f"{i}. {q.title} ({q.points}p)" for i, q in enumerate(exam.questions, start=1)],
                     "Összesen", "Maximum", "Javításra vár"])
    for attempt in _attempts(db, exam_id):
        by_q = {a.question_id: a for a in attempt.answers}
        cells = []
        for q in exam.questions:
            a = by_q.get(q.id)
            cells.append("" if a is None or a.status == STATUS_PENDING_REVIEW else a.score)
        writer.writerow([
            attempt.user.full_name, attempt.user.email,
            as_utc(attempt.started_at).strftime("%Y-%m-%d %H:%M:%S UTC"),
            as_utc(attempt.finished_at).strftime("%Y-%m-%d %H:%M:%S UTC") if attempt.finished_at else "folyamatban",
            attempt.violations, *cells,
            grading.total_score(attempt), grading.max_score(attempt), grading.pending_review(attempt),
        ])
    # BOM, hogy az Excel UTF-8-ként nyissa meg (ékezetek)
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="vizsga_{exam_id}_eredmenyek.csv"'})


@router.patch("/answers/{answer_id}/grade", response_model=AnswerTeacher)
def grade_answer_manually(answer_id: int, body: GradeRequest, db: Session = Depends(get_db),
                          teacher: User = Depends(require_teacher)):
    """Kézi pontozás / felülírás és szöveges visszajelzés.
    manual_score = null → visszaáll az automatikus pontra (esszénél újra 'javításra vár')."""
    answer = db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="A válasz nem található.")
    get_owned_exam(db, answer.attempt.exam_id, teacher)
    if body.manual_score is not None and body.manual_score > answer.question.points:
        raise HTTPException(status_code=422, detail=f"Legfeljebb {answer.question.points} pont adható.")

    answer.manual_score = body.manual_score
    answer.feedback = body.feedback or None
    if body.manual_score is not None:
        answer.status = STATUS_GRADED
    elif answer.question.type == "essay" and not grading.is_empty_response(answer.response):
        answer.status = STATUS_PENDING_REVIEW
    db.commit()
    db.refresh(answer)
    return answer


@router.post("/exams/{exam_id}/regrade")
def regrade(exam_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    """A lezárt kitöltések még nem értékelt válaszainak újraértékelése
    (pl. ha beadáskor nem futott a Docker)."""
    get_owned_exam(db, exam_id, teacher)
    count = 0
    for attempt in _attempts(db, exam_id):
        if attempt.finished_at is None:
            continue
        for answer in attempt.answers:
            if answer.status == STATUS_NOT_GRADED:
                grading.apply_grade(answer, grading.grade_answer(answer.question, answer.response))
                count += answer.status != STATUS_NOT_GRADED
    db.commit()
    return {"regraded": count}
