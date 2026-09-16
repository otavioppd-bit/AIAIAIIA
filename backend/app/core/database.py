"""SQLAlchemy engine, session factory and declarative base."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

_connect_args: dict = {}
if settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables for zero-config local development.

    Only SQLite is bootstrapped this way. Any other backend is expected to be
    migrated with Alembic (`alembic upgrade head`), so that schema changes are
    versioned and reviewable instead of being applied implicitly on boot.
    """
    from app import models  # noqa: F401  (register mappers)

    if not settings.database_url.startswith("sqlite"):
        return
    Base.metadata.create_all(bind=engine)
