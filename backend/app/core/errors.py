"""Typed application errors mapped to HTTP responses."""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base class for errors that are safe to surface to the client."""

    status_code: int = 400
    code: str = "app_error"

    def __init__(self, message: str, *, details: Any = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details
        if code:
            self.code = code

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class PermissionDeniedError(AppError):
    status_code = 403
    code = "forbidden"


class AuthError(AppError):
    status_code = 401
    code = "unauthorized"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class ValidationError(AppError):
    status_code = 422
    code = "validation_error"


class FileTooLargeError(AppError):
    status_code = 413
    code = "file_too_large"


class UnprocessableDatasetError(AppError):
    status_code = 422
    code = "unprocessable_dataset"
