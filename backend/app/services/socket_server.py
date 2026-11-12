"""
Valós idejű proctoring (Socket.io).

  - Kapcsolódáskor a kliens a JWT tokent küldi (auth: {token}); érvénytelen tokennel nem csatlakozhat.
  - A szerepkört és a nevet az adatbázisból vesszük, nem a klienstől.
  - Oktató csak a saját vizsgája szobájába léphet be; hallgató csak akkor, ha folyamatban lévő kitöltése van.
  - A szabályszegések száma az Attempt.violations mezőben tárolódik (oldalfrissítés után is megmarad).
"""
import asyncio
from collections import defaultdict

import socketio
from jose import JWTError
from socketio.exceptions import ConnectionRefusedError

from app.core.database import SessionLocal
from app.core.security import decode_token
from app.models.models import Attempt, Exam, User
from app.services.grading import is_active
from config import FRONTEND_ORIGINS

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=FRONTEND_ORIGINS)

# exam_id -> user_id -> {sid, ...}   (egy hallgató több lapon is lehet)
_online: dict[int, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))


def _room(exam_id: int) -> str:
    return f"exam_{exam_id}"


# --- Szinkron DB műveletek (külön szálon futtatva) ---

def _load_user(token: str):
    email = decode_token(token).get("sub")
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        return None if user is None else {"user_id": user.id, "role": user.role, "name": user.full_name}


def _check_join(exam_id: int, user_id: int, role: str) -> str | None:
    """None, ha beléphet; különben a hibaüzenet."""
    with SessionLocal() as db:
        exam = db.get(Exam, exam_id)
        if exam is None:
            return "A vizsga nem található."
        if role == "teacher":
            return None if exam.created_by == user_id else "Ez nem a te vizsgád."
        attempt = db.query(Attempt).filter(Attempt.exam_id == exam_id, Attempt.user_id == user_id).first()
        if attempt is None or not is_active(attempt, grace_seconds=0):
            return "Nincs folyamatban lévő kitöltésed ehhez a vizsgához."
        return None


def _snapshot(exam_id: int) -> list[dict]:
    with SessionLocal() as db:
        attempts = db.query(Attempt).filter(Attempt.exam_id == exam_id).all()
        return [{
            "user_id": a.user_id,
            "student_name": a.user.full_name,
            "violations": a.violations,
            "finished": a.finished_at is not None,
            "online": bool(_online[exam_id].get(a.user_id)),
        } for a in attempts]


def _add_violation(exam_id: int, user_id: int) -> int | None:
    with SessionLocal() as db:
        attempt = db.query(Attempt).filter(Attempt.exam_id == exam_id, Attempt.user_id == user_id).first()
        if attempt is None or not is_active(attempt):
            return None
        attempt.violations += 1
        db.commit()
        return attempt.violations


# --- Események ---

@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token")
    if not token:
        raise ConnectionRefusedError("Hiányzó token.")
    try:
        user = await asyncio.to_thread(_load_user, token)
    except JWTError:
        raise ConnectionRefusedError("Érvénytelen token.")
    if user is None:
        raise ConnectionRefusedError("Ismeretlen felhasználó.")
    await sio.save_session(sid, user)


@sio.event
async def join_exam(sid, data):
    """data = {"exam_id": 1}. Visszatérés (ack): {"ok": bool, "error"?: str}"""
    session = await sio.get_session(sid)
    try:
        exam_id = int((data or {}).get("exam_id"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Hibás vizsgaazonosító."}

    error = await asyncio.to_thread(_check_join, exam_id, session["user_id"], session["role"])
    if error:
        return {"ok": False, "error": error}

    session["exam_id"] = exam_id
    await sio.save_session(sid, session)
    await sio.enter_room(sid, _room(exam_id))

    if session["role"] == "teacher":
        await sio.emit("monitor_snapshot", await asyncio.to_thread(_snapshot, exam_id), to=sid)
    else:
        _online[exam_id][session["user_id"]].add(sid)
        await sio.emit("student_joined", {"user_id": session["user_id"], "student_name": session["name"]},
                       room=_room(exam_id), skip_sid=sid)
    return {"ok": True}


@sio.event
async def report_violation(sid, data):
    """Hallgatói proctoring esemény (pl. ablakváltás) mentése és továbbítása az oktatónak."""
    session = await sio.get_session(sid)
    exam_id = session.get("exam_id")
    if session.get("role") != "student" or exam_id is None:
        return
    count = await asyncio.to_thread(_add_violation, exam_id, session["user_id"])
    if count is None:
        return  # már beadta / lejárt
    await sio.emit("violation_alert", {
        "user_id": session["user_id"],
        "student_name": session["name"],
        "event_type": str((data or {}).get("event_type", "WINDOW_BLUR"))[:100],
        "timestamp": (data or {}).get("timestamp"),
        "violations": count,
    }, room=_room(exam_id), skip_sid=sid)


def _is_finished(exam_id: int, user_id: int) -> bool:
    with SessionLocal() as db:
        attempt = db.query(Attempt).filter(Attempt.exam_id == exam_id, Attempt.user_id == user_id).first()
        return attempt is not None and attempt.finished_at is not None


@sio.event
async def exam_finished(sid, data=None):
    """A hallgató kliense jelzi a beadást – ellenőrizzük az adatbázisban, és értesítjük az oktatót."""
    session = await sio.get_session(sid)
    exam_id = session.get("exam_id")
    if session.get("role") != "student" or exam_id is None:
        return
    if await asyncio.to_thread(_is_finished, exam_id, session["user_id"]):
        await sio.emit("student_finished", {"user_id": session["user_id"]}, room=_room(exam_id), skip_sid=sid)
        await _leave(sid)


@sio.event
async def leave_exam(sid, data=None):
    await _leave(sid)


async def _leave(sid):
    session = await sio.get_session(sid)
    exam_id = session.get("exam_id")
    if exam_id is None:
        return
    await sio.leave_room(sid, _room(exam_id))
    session.pop("exam_id", None)
    await sio.save_session(sid, session)
    if session.get("role") == "student":
        sids = _online[exam_id][session["user_id"]]
        sids.discard(sid)
        if not sids:
            await sio.emit("student_left", {"user_id": session["user_id"]}, room=_room(exam_id))


@sio.event
async def disconnect(sid):
    try:
        await _leave(sid)
    except KeyError:
        pass
