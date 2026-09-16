"""Authentication request/response models."""
from __future__ import annotations

import re

from pydantic import BaseModel, EmailStr, Field, field_validator

_PASSWORD_MIN = 8


def _validate_password(value: str) -> str:
    if len(value) < _PASSWORD_MIN:
        raise ValueError(f"A senha deve ter ao menos {_PASSWORD_MIN} caracteres.")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("A senha deve conter letras e números.")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=_PASSWORD_MIN, max_length=128)
    full_name: str = Field(default="", max_length=160)
    company: str = Field(default="", max_length=160)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=_PASSWORD_MIN, max_length=128)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    company: str | None = Field(default=None, max_length=160)
    preferred_theme: str | None = Field(default=None, max_length=32)
    locale: str | None = Field(default=None, max_length=8)
    onboarding_completed: bool | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=_PASSWORD_MIN, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    company: str
    onboarding_completed: bool
    preferred_theme: str
    locale: str

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
