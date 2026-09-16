"""Authentication endpoints: register, login, refresh, password reset, profile."""
from __future__ import annotations

import logging

import jwt
from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.errors import AuthError, ConflictError, ValidationError
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models import User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _issue_tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserResponse.model_validate(user),
    )


def _normalise_email(email: str) -> str:
    return email.strip().lower()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DbSession) -> TokenResponse:
    email = _normalise_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ConflictError("Já existe uma conta com este e-mail.")

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        company=payload.company.strip(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue_tokens(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    email = _normalise_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    # Always run the hash comparison so a missing account and a wrong password
    # take the same amount of time.
    hashed = user.hashed_password if user else "$2b$12$" + "x" * 53
    password_ok = verify_password(payload.password, hashed)

    if user is None or not password_ok:
        raise AuthError("E-mail ou senha incorretos.")
    if not user.is_active:
        raise AuthError("Esta conta está desativada.")
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: DbSession) -> TokenResponse:
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Sessão expirada. Faça login novamente.") from exc
    except jwt.PyJWTError as exc:
        raise AuthError("Token de atualização inválido.") from exc

    user = db.get(User, claims.get("sub"))
    if user is None or not user.is_active:
        raise AuthError("Usuário não encontrado.")
    return _issue_tokens(user)


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(payload: ForgotPasswordRequest, db: DbSession) -> MessageResponse:
    """Issue a reset token.

    The response is identical whether or not the account exists, so this
    endpoint cannot be used to enumerate registered e-mails.
    """
    email = _normalise_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        token = create_token(user.id, "reset", extra_claims={"pwd": user.hashed_password[-16:]})
        # A real deployment mails this link; in development it goes to the log
        # so the flow is testable without an SMTP server.
        logger.info(
            "Token de redefinição de senha para %s: %s (válido por %s minutos)",
            email,
            token,
            settings.password_reset_expire_minutes,
        )
        if not settings.is_production:
            return MessageResponse(
                message="Se o e-mail estiver cadastrado, enviaremos as instruções. "
                f"[DEV] token: {token}"
            )
    return MessageResponse(
        message="Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição."
    )


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, db: DbSession) -> MessageResponse:
    try:
        claims = decode_token(payload.token, expected_type="reset")
    except jwt.ExpiredSignatureError as exc:
        raise ValidationError("O link de redefinição expirou. Solicite um novo.") from exc
    except jwt.PyJWTError as exc:
        raise ValidationError("Link de redefinição inválido.") from exc

    user = db.get(User, claims.get("sub"))
    if user is None:
        raise ValidationError("Link de redefinição inválido.")
    # Binding the token to the current hash makes it single-use: once the
    # password changes, previously issued reset tokens stop validating.
    if claims.get("pwd") != user.hashed_password[-16:]:
        raise ValidationError("Este link já foi utilizado. Solicite um novo.")

    user.hashed_password = hash_password(payload.password)
    db.commit()
    return MessageResponse(message="Senha redefinida com sucesso.")


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
def update_profile(
    payload: UpdateProfileRequest, user: CurrentUser, db: DbSession
) -> UserResponse:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.company is not None:
        user.company = payload.company.strip()
    if payload.preferred_theme is not None:
        user.preferred_theme = payload.preferred_theme.strip()
    if payload.locale is not None:
        user.locale = payload.locale.strip()
    if payload.onboarding_completed is not None:
        user.onboarding_completed = payload.onboarding_completed
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest, user: CurrentUser, db: DbSession
) -> MessageResponse:
    if not verify_password(payload.current_password, user.hashed_password):
        raise AuthError("A senha atual está incorreta.")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return MessageResponse(message="Senha alterada com sucesso.")
