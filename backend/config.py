"""Központi beállítások. Környezeti változókkal felülírhatók."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:password@localhost:5432/exam_system_db"
)
SECRET_KEY = os.getenv("SECRET_KEY", "iskola_szakdolgozat_super_secret_key_change_me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 nap

# Oktatói fiók csak ezzel a meghívókóddal regisztrálható (üres = oktatói regisztráció letiltva)
TEACHER_INVITE_CODE = os.getenv("TEACHER_INVITE_CODE", "oktato123")

SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "python:3.11-slim")
SANDBOX_TIMEOUT_SECONDS = int(os.getenv("SANDBOX_TIMEOUT_SECONDS", "5"))  # tesztesetenként
SANDBOX_OUTPUT_LIMIT = int(os.getenv("SANDBOX_OUTPUT_LIMIT", "65536"))   # bájt / teszteset
MAX_CODE_LENGTH = 50_000  # karakter

FRONTEND_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
