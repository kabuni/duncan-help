from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
import uuid


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    role_title: Optional[str] = None
    department: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserPublic"


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserPublic(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    role_title: Optional[str] = None
    department: Optional[str] = None
    bio: Optional[str] = None
    norman_context: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str
    roles: list[str] = []
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class GoogleOAuthCallback(BaseModel):
    code: str
    state: Optional[str] = None
