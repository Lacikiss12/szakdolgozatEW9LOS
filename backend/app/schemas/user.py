from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    password: str = Field(min_length=4, max_length=72)  # bcrypt max 72 bájt
    # Ha helyes oktatói meghívókódot ad meg, oktatói fiók jön létre; egyébként hallgatói.
    invite_code: Optional[str] = Field(default=None, max_length=200)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str


class Token(BaseModel):
    access_token: str
    token_type: str
