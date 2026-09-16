"""Application configuration, loaded from environment variables."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- App -------------------------------------------------------------
    app_name: str = "Prisma Analytics API"
    environment: str = Field(default="development")
    debug: bool = Field(default=True)
    api_v1_prefix: str = "/api/v1"

    # --- Security --------------------------------------------------------
    secret_key: str = Field(default="dev-secret-change-me-in-production")
    access_token_expire_minutes: int = 60 * 12
    refresh_token_expire_minutes: int = 60 * 24 * 14
    password_reset_expire_minutes: int = 30
    jwt_algorithm: str = "HS256"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # --- Storage ---------------------------------------------------------
    database_url: str = Field(default=f"sqlite:///{BASE_DIR / 'storage' / 'prisma.db'}")
    storage_dir: Path = Field(default=BASE_DIR / "storage" / "datasets")
    upload_dir: Path = Field(default=BASE_DIR / "storage" / "uploads")

    # --- Upload limits ---------------------------------------------------
    max_upload_bytes: int = 100 * 1024 * 1024  # 100 MB
    max_rows: int = 2_000_000
    max_columns: int = 512
    sample_rows_for_analysis: int = 250_000

    # --- LLM -------------------------------------------------------------
    llm_provider: str = Field(default="auto")  # auto | anthropic | openai | heuristic
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    llm_timeout_seconds: float = 45.0
    llm_max_tokens: int = 3000

    @field_validator("storage_dir", "upload_dir", mode="after")
    @classmethod
    def _ensure_dir(cls, value: Path) -> Path:
        value.mkdir(parents=True, exist_ok=True)
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        (BASE_DIR / "storage").mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()
