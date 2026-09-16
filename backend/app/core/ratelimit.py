"""Request rate limiting.

Applied where abuse is cheap and damaging: credential endpoints (brute force
and account enumeration) and uploads (resource exhaustion). The limiter keys on
the client address, so a deployment behind a proxy must forward the real IP.
"""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings


def _client_key(request: Request) -> str:
    """Prefer the proxy-forwarded address when one is present."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=_client_key,
    # Disabled in tests so the suite is not order-dependent.
    enabled=settings.environment.lower() != "test",
    # Header injection on the decorator path requires the handler to accept a
    # `response: Response` argument and raises on every successful call
    # otherwise. SlowAPIMiddleware adds the headers instead, and the 429 body
    # below carries Retry-After explicitly.
    headers_enabled=False,
)

# Tight enough to stop automated guessing, loose enough that a person who
# mistypes a password three times is never locked out.
LOGIN_LIMIT = "10/minute"
REGISTER_LIMIT = "5/minute"
PASSWORD_RESET_LIMIT = "5/minute"
UPLOAD_LIMIT = "20/hour"
ASK_LIMIT = "60/minute"


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    retry_after = getattr(exc, "retry_after", None) or 60
    return JSONResponse(
        status_code=429,
        content={
            "code": "rate_limited",
            "message": "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.",
        },
        headers={"Retry-After": str(retry_after)},
    )
