"""FastAPI application entry point."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.ai.providers import provider_status
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import init_db
from app.core.errors import AppError
from app.core.ratelimit import limiter, rate_limit_handler
from app.schemas.common import HealthResponse

VERSION = "1.0.0"

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("prisma")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    status = provider_status()
    logger.info(
        "Prisma Analytics iniciado — IA: %s (%s)",
        status["provider"],
        "modelo configurado" if status["available"] else "modo determinístico",
    )
    yield


app = FastAPI(
    title=settings.app_name,
    version=VERSION,
    description=(
        "API de análise de dados com IA. Todo número exposto por esta API é "
        "calculado deterministicamente a partir do arquivo enviado."
    ),
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    max_age=600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Response-Time"] = f"{(time.perf_counter() - started) * 1000:.1f}ms"
    return response


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Pydantic's raw error list leaks internal field paths, so it is reshaped
    # into a flat, user-readable list.
    details = [
        {
            "field": ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query")),
            "message": err.get("msg", "Valor inválido"),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "code": "validation_error",
            "message": "Os dados enviados são inválidos.",
            "details": details,
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Erro não tratado em %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "code": "internal_error",
            "message": "Ocorreu um erro interno. Tente novamente em instantes.",
        },
    )


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Liveness probe.

    Anonymous by necessity (load balancers call it), so it discloses only
    whether a model backend is configured — never which one. The provider and
    model names live behind auth at /api/v1/ai/status.
    """
    return HealthResponse(
        status="ok",
        version=VERSION,
        environment=settings.environment,
        llm={"mode": provider_status()["mode"]},
    )


app.include_router(api_router, prefix=settings.api_v1_prefix)
