from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.database import get_db
from app.models.models import Exam, Question, User
from app.schemas.exam import ExamCreate, ExamSummary, ExamTeacher, QuestionCreate, QuestionTeacher

router = APIRouter(prefix="/exams", tags=["Exams & Questions"])


def require_teacher(current_user: User = Depends(get_current_user)) -> User:
    """Függőség: csak oktatói szerepkörrel engedi tovább a kérést."""
    if current_user.role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ehhez oktatói jogosultság szükséges.")
    return current_user


def get_exam_or_404(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="A vizsga nem található.")
    return exam


def get_owned_exam(db: Session, exam_id: int, teacher: User) -> Exam:
    """A vizsgát csak a létrehozó oktató kezelheti."""
    exam = get_exam_or_404(db, exam_id)
    if exam.created_by != teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ez nem a te vizsgád.")
    return exam


@router.post("/", response_model=ExamTeacher)
def create_exam(exam_in: ExamCreate, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    """Új vizsga létrehozása (csak oktatók)."""
    exam = Exam(**exam_in.model_dump(), created_by=teacher.id)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("/", response_model=list[ExamSummary])
def list_exams(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Az összes vizsga listázása (feladatok nélkül)."""
    return db.query(Exam).order_by(Exam.start_time.desc(), Exam.id.desc()).all()


@router.get("/{exam_id}", response_model=ExamTeacher)
def get_exam(exam_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    """Vizsga részletei a megoldókulcsokkal (csak a létrehozó oktatónak).
    A hallgatók a feladatokat a vizsga elkezdésekor kapják meg (POST /exams/{id}/attempt)."""
    return get_owned_exam(db, exam_id, teacher)


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(exam_id: int, db: Session = Depends(get_db), teacher: User = Depends(require_teacher)):
    exam = get_owned_exam(db, exam_id, teacher)
    db.delete(exam)
    db.commit()


@router.post("/{exam_id}/questions", response_model=QuestionTeacher)
def add_question_to_exam(
    exam_id: int,
    question_in: QuestionCreate,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    """Feladat hozzáadása (bármely típus). A megoldókulcs formátuma típusonként a Question modellnél."""
    get_owned_exam(db, exam_id, teacher)
    last = db.query(func.max(Question.position)).filter(Question.exam_id == exam_id).scalar()
    question = Question(exam_id=exam_id, position=(last or 0) + 1, **question_in.model_dump())
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/{exam_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(exam_id: int, question_id: int, db: Session = Depends(get_db),
                    teacher: User = Depends(require_teacher)):
    get_owned_exam(db, exam_id, teacher)
    question = db.get(Question, question_id)
    if not question or question.exam_id != exam_id:
        raise HTTPException(status_code=404, detail="A feladat nem található.")
    db.delete(question)
    db.commit()
