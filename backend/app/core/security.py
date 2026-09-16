"""Password hashing and JWT token helpers."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from passlib.context import CryptContext

from app.core.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh", "reset"]


def hash_password(password: str) -> str:
    # bcrypt silently truncates at 72 bytes; pre-hash so long passwords keep entropy.
    return _pwd_context.hash(_prepare(password))


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(_prepare(plain), hashed)
    except ValueError:
        return False


def _prepare(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) <= 72:
        return password
    return hashlib.sha256(raw).hexdigest()


def create_token(
    subject: str,
    token_type: TokenType = "access",
    expires_minutes: int | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    defaults = {
        "access": settings.access_token_expire_minutes,
        "refresh": settings.refresh_token_expire_minutes,
        "reset": settings.password_reset_expire_minutes,
    }
    minutes = expires_minutes if expires_minutes is not None else defaults[token_type]
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
        "jti": secrets.token_urlsafe(12),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: TokenType | None = None) -> dict[str, Any]:
    """Decode a JWT. Raises jwt.PyJWTError on any problem."""
    payload = jwt.decode(
        token, settings.secret_key, algorithms=[settings.jwt_algorithm]
    )
    if expected_type and payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload
