"""
Feladattípusonkénti értékelés és a vizsgák lezárása.

  code             – sandbox, tesztesetek arányában (nyilvános tesztek részletesen, rejtettek csak összesítve)
  single_choice    – teljes pont, ha a jó választ jelölte
  true_false       – ugyanaz, mint az egyválasztós
  multiple_choice  – (jó jelölések − rossz jelölések) / összes jó  × pont, minimum 0
  short_text       – az elfogadott válaszok egyikével egyezik (kis/nagybetű és szóközök nem számítanak,
                     számoknál számértéket hasonlít)
  essay            – oktatói kézi javításra vár
"""
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.timeutils import as_utc, utcnow
from app.models.models import (
    Answer, Attempt, Question, STATUS_GRADED, STATUS_NOT_GRADED, STATUS_PENDING_REVIEW,
)
from app.services.sandbox import run_tests

AUTO_GRADED_TYPES = ("single_choice", "multiple_choice", "true_false", "short_text")


@dataclass
class GradeResult:
    auto_score: Optional[int]
    status: str
    eval_output: Optional[str] = None


# --- Segédfüggvények ---

def _normalize(text: Any) -> str:
    return " ".join(str(text).split()).casefold()


def _as_number(text: str) -> Optional[float]:
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def _selected(response: Any) -> set[int]:
    if isinstance(response, int):
        return {response}
    if isinstance(response, list):
        return {i for i in response if isinstance(i, int)}
    return set()


def is_empty_response(response: Any) -> bool:
    if response is None:
        return True
    if isinstance(response, str):
        return not response.strip()
    if isinstance(response, list):
        return len(response) == 0
    return False


def validate_response(question: Question, response: Any) -> Any:
    """Ellenőrzi a beküldött válasz formáját; ValueError-t dob, ha hibás."""
    if response is None:
        return None
    if question.type in ("code", "short_text", "essay"):
        if not isinstance(response, str):
            raise ValueError("A válasz szöveg legyen.")
        limit = 50_000 if question.type != "short_text" else 1_000
        if len(response) > limit:
            raise ValueError(f"A válasz túl hosszú (max. {limit} karakter).")
        return response
    # választós
    sel = _selected(response)
    n = len(question.options or [])
    if any(i < 0 or i >= n for i in sel):
        raise ValueError("Nem létező válaszlehetőség.")
    if question.type in ("single_choice", "true_false") and len(sel) > 1:
        raise ValueError("Ennél a feladatnál csak egy válasz jelölhető meg.")
    return sorted(sel)


# --- Kódfeladat ---

def _code_tests(question: Question) -> list[dict]:
    return [t for t in (question.answer_key or []) if isinstance(t, dict)]


def _describe_failure(res: dict) -> str:
    if res.get("timed_out"):
        return "időtúllépés"
    if res.get("exit_code") != 0:
        return "futási hiba"
    return "hibás kimenet"


def grade_code(question: Question, code: str) -> GradeResult:
    tests = _code_tests(question)
    if not tests:
        # Nincs teszteset: elég, ha hiba nélkül lefut
        run = run_tests(code, [""])
        if run["error"]:
            return GradeResult(None, STATUS_NOT_GRADED, f"Rendszerhiba: {run['error']}")
        res = run["results"][0]
        ok = res["exit_code"] == 0 and not res["timed_out"]
        out = res["output"] or "(nincs kimenet)"
        if res["error"]:
            out += f"\n\n--- Hibaüzenet ---\n{res['error']}"
        return GradeResult(question.points if ok else 0, STATUS_GRADED,
                           f"{'Hibátlan futás' if ok else 'Hibás futás'}\n\n{out}")

    run = run_tests(code, [t["input"] for t in tests])
    if run["error"]:
        # Rendszerhiba (pl. nem fut a Docker): nem pontozzuk le a hallgatót, később újra értékelhető
        return GradeResult(None, STATUS_NOT_GRADED, f"Rendszerhiba: {run['error']}")

    passed = 0
    public_lines, hidden_lines = [], []
    first_error = None
    for i, (test, res) in enumerate(zip(tests, run["results"]), start=1):
        expected = str(test.get("expected_output", "")).strip()
        actual = res["output"].strip()
        ok = res["exit_code"] == 0 and not res["timed_out"] and actual == expected
        passed += ok
        if test.get("public"):
            if ok:
                public_lines.append(f"  [{i}] SIKERES")
            else:
                public_lines.append(f"  [{i}] HIBÁS ({_describe_failure(res)}) | bemenet: {test.get('input', '')!r}"
                                    f" | várt: {expected!r} | kapott: {actual[:500]!r}")
                if res["error"] and not first_error:
                    first_error = res["error"]
        else:
            # A rejtett teszt bemenetét/elvárt kimenetét és hibaüzenetét NEM mutatjuk meg
            hidden_lines.append(f"  [{i}] {'SIKERES' if ok else 'HIBÁS (' + _describe_failure(res) + ')'}")

    score = int(passed / len(tests) * question.points)
    parts = [f"Sikeres tesztek: {passed}/{len(tests)}"]
    if public_lines:
        parts.append("Példatesztek:\n" + "\n".join(public_lines))
    if hidden_lines:
        parts.append("Rejtett tesztek:\n" + "\n".join(hidden_lines))
    if first_error:
        parts.append(f"--- Hibaüzenet (első hibás példateszt) ---\n{first_error}")
    parts.append(f"Pontszám: {score}/{question.points}")
    return GradeResult(score, STATUS_GRADED, "\n\n".join(parts))


def run_code_preview(question: Question, code: str, custom_input: Optional[str]) -> str:
    """Próbafuttatás (nem pontoz): saját bemenettel, vagy a nyilvános példatesztekkel."""
    if custom_input is not None or not question.public_tests:
        run = run_tests(code, [custom_input or ""])
        if run["error"]:
            return f"Rendszerhiba: {run['error']}"
        res = run["results"][0]
        out = res["output"] or "(nincs kimenet)"
        if res["timed_out"]:
            out += "\n\n[Időtúllépés]"
        if res["error"]:
            out += f"\n\n--- Hibaüzenet ---\n{res['error']}"
        return out

    tests = question.public_tests
    run = run_tests(code, [t["input"] for t in tests])
    if run["error"]:
        return f"Rendszerhiba: {run['error']}"
    lines, passed = [], 0
    for i, (test, res) in enumerate(zip(tests, run["results"]), start=1):
        expected, actual = test["expected_output"].strip(), res["output"].strip()
        ok = res["exit_code"] == 0 and not res["timed_out"] and actual == expected
        passed += ok
        line = f"[{i}] {'SIKERES' if ok else 'HIBÁS (' + _describe_failure(res) + ')'}" \
               f" | bemenet: {test['input']!r} | várt: {expected!r} | kapott: {actual[:500]!r}"
        if res["error"] and not ok:
            line += f"\n{res['error']}"
        lines.append(line)
    return f"Példatesztek: {passed}/{len(tests)} sikeres (próbafuttatás, nem pontozott)\n\n" + "\n".join(lines)


# --- Általános ---

def grade_answer(question: Question, response: Any) -> GradeResult:
    if is_empty_response(response):
        return GradeResult(0, STATUS_GRADED, None)

    t = question.type
    if t == "code":
        return grade_code(question, response)
    if t == "essay":
        return GradeResult(None, STATUS_PENDING_REVIEW)
    if t in ("single_choice", "true_false"):
        ok = _selected(response) == set(question.answer_key or [])
        return GradeResult(question.points if ok else 0, STATUS_GRADED)
    if t == "multiple_choice":
        correct = set(question.answer_key or [])
        sel = _selected(response)
        if not correct:
            return GradeResult(0, STATUS_GRADED)
        ratio = max(0.0, (len(sel & correct) - len(sel - correct)) / len(correct))
        return GradeResult(int(round(ratio * question.points)), STATUS_GRADED)
    if t == "short_text":
        given = _normalize(response)
        given_num = _as_number(given)
        for accepted in question.answer_key or []:
            acc = _normalize(accepted)
            acc_num = _as_number(acc)
            if given == acc or (given_num is not None and acc_num is not None and abs(given_num - acc_num) < 1e-9):
                return GradeResult(question.points, STATUS_GRADED)
        return GradeResult(0, STATUS_GRADED)
    return GradeResult(None, STATUS_PENDING_REVIEW)


def apply_grade(answer: Answer, result: GradeResult) -> None:
    answer.auto_score = result.auto_score
    answer.status = result.status
    if result.eval_output is not None or answer.question.type != "code":
        answer.eval_output = result.eval_output
    if result.status == STATUS_GRADED and answer.question.type == "essay":
        answer.manual_score = None


# --- Próbálkozás (Attempt) ---

def is_active(attempt: Attempt, grace_seconds: int = 30) -> bool:
    """Még dolgozhat-e rajta a hallgató (kis türelmi idővel a hálózati késés miatt)."""
    if attempt.finished_at is not None:
        return False
    return (utcnow() - as_utc(attempt.deadline)).total_seconds() <= grace_seconds


def max_score(attempt: Attempt) -> int:
    return sum(q.points for q in attempt.exam.questions)


def total_score(attempt: Attempt) -> int:
    return sum(a.score for a in attempt.answers)


def pending_review(attempt: Attempt) -> int:
    return sum(1 for a in attempt.answers if a.status == STATUS_PENDING_REVIEW)


def get_or_create_answer(db: Session, attempt: Attempt, question: Question) -> Answer:
    for a in attempt.answers:
        if a.question_id == question.id:
            return a
    answer = Answer(attempt=attempt, question=question, status=STATUS_NOT_GRADED)
    db.add(answer)
    return answer


def finalize_attempt(db: Session, attempt: Attempt) -> None:
    """Lezárja a próbálkozást: minden még nem értékelt választ értékel (a hiányzókat 0 ponttal)."""
    if attempt.finished_at is not None:
        return
    for question in attempt.exam.questions:
        answer = get_or_create_answer(db, attempt, question)
        if answer.status == STATUS_NOT_GRADED:
            apply_grade(answer, grade_answer(question, answer.response))
    attempt.finished_at = min(utcnow(), as_utc(attempt.deadline))
    db.commit()
    db.refresh(attempt)


def finalize_if_expired(db: Session, attempt: Attempt) -> None:
    if attempt.finished_at is None and not is_active(attempt):
        finalize_attempt(db, attempt)
