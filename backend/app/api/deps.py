"""Shared FastAPI dependencies: authentication and resource loading."""
from __future__ import annotations

from typing import Annotated

import jwt
import pandas as pd
from fastapi import Depends, Header, Path
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AuthError, NotFoundError
from app.core.security import decode_token
from app.models import Dashboard, Dataset, DatasetStatus, User
from app.services import storage


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    """Resolve the authenticated user from a bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Autenticação necessária.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token, expected_type="access")
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Sessão expirada. Faça login novamente.") from exc
    except jwt.PyJWTError as exc:
        raise AuthError("Token de acesso inválido.") from exc

    user = db.get(User, payload.get("sub"))
    if user is None or not user.is_active:
        raise AuthError("Usuário não encontrado ou inativo.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


def get_owned_dataset(
    dataset_id: Annotated[str, Path()],
    user: CurrentUser,
    db: DbSession,
) -> Dataset:
    """Load a dataset, enforcing that it belongs to the caller."""
    dataset = db.get(Dataset, dataset_id)
    # A dataset owned by someone else is reported as missing, not forbidden,
    # so the API never confirms that another user's ID exists.
    if dataset is None or dataset.user_id != user.id:
        raise NotFoundError("Conjunto de dados não encontrado.")
    return dataset


OwnedDataset = Annotated[Dataset, Depends(get_owned_dataset)]


def get_ready_dataset(dataset: OwnedDataset) -> Dataset:
    if dataset.status != DatasetStatus.READY:
        raise NotFoundError(
            f"O conjunto de dados ainda não está pronto (status: {dataset.status.value})."
        )
    return dataset


ReadyDataset = Annotated[Dataset, Depends(get_ready_dataset)]


def load_dataset_frame(dataset: Dataset) -> pd.DataFrame:
    return storage.load_dataframe(dataset.user_id, dataset.id)


def get_owned_dashboard(
    dashboard_id: Annotated[str, Path()],
    user: CurrentUser,
    db: DbSession,
) -> Dashboard:
    dashboard = db.get(Dashboard, dashboard_id)
    if dashboard is None or dashboard.user_id != user.id:
        raise NotFoundError("Dashboard não encontrado.")
    return dashboard


OwnedDashboard = Annotated[Dashboard, Depends(get_owned_dashboard)]
