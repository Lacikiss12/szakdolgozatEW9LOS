import hmac

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import create_access_token, decode_token, get_password_hash, verify_password
from app.models.models import User
from app.schemas.user import UserCreate, UserResponse, Token
from config import TEACHER_INVITE_CODE

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Nem sikerült hitelesíteni a felhasználót",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        email = decode_token(token).get("sub")
    except JWTError:
        raise credentials_exception
    if email is None:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user


@router.post("/register", response_model=UserResponse)
def register_user(user_in: UserCreate, db: Session = Depends(get_db)):
    """Új felhasználó regisztrációja. Alapból hallgató; oktató csak érvényes meghívókóddal lehet."""
    role = "student"
    if user_in.invite_code:
        if not TEACHER_INVITE_CODE or not hmac.compare_digest(user_in.invite_code.encode(),
                                                              TEACHER_INVITE_CODE.encode()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Érvénytelen oktatói meghívókód.")
        role = "teacher"

    if db.query(User).filter(User.email == user_in.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ezzel az e-mail címmel már regisztráltak fiókot.",
        )

    db_user = User(
        email=user_in.email,
        full_name=user_in.full_name,
        hashed_password=get_password_hash(user_in.password),
        role=role,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.post("/login", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Bejelentkezés OAuth2 form adatokkal (username = e-mail), JWT tokent ad vissza."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Helytelen e-mail cím vagy jelszó",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": create_access_token({"sub": user.email}), "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    """A bejelentkezett felhasználó adatai."""
    return current_user
