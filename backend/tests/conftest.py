"""Test fixtures: isolated database, storage and authenticated client."""
from __future__ import annotations

import io
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="prisma-tests-")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["STORAGE_DIR"] = f"{_tmp}/datasets"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["LLM_PROVIDER"] = "heuristic"
os.environ["ENVIRONMENT"] = "test"

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import storage  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _clear_cache():
    storage.clear_cache()
    yield


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_client(client: TestClient) -> TestClient:
    import uuid

    email = f"user-{uuid.uuid4().hex[:8]}@exemplo.com"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "SenhaSegura123", "full_name": "Ana Teste"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


@pytest.fixture
def sales_csv() -> bytes:
    """A small but realistic sales dataset with BR formatting and noise."""
    rng = np.random.default_rng(11)
    n = 600
    produtos = ["Notebook", "Monitor", "Teclado", "Mouse", "Headset"]
    precos = {"Notebook": 6800, "Monitor": 1450, "Teclado": 420, "Mouse": 180, "Headset": 340}
    ufs = ["SP", "RJ", "MG", "RS", "PR"]

    dates = pd.to_datetime("2024-01-01") + pd.to_timedelta(
        rng.integers(0, 730, n), unit="D"
    )
    rows = []
    for i in range(n):
        produto = produtos[int(rng.integers(0, len(produtos)))]
        qtd = int(rng.integers(1, 6))
        preco = precos[produto] * float(rng.normal(1, 0.05))
        mes_idx = (dates[i].year - 2024) * 12 + dates[i].month - 1
        total = preco * qtd * (1 + 0.02 * mes_idx)
        rows.append(
            {
                "pedido_id": f"PED-{1000 + i}",
                "data_pedido": dates[i].strftime("%d/%m/%Y"),
                "produto": produto,
                "uf": ufs[int(rng.integers(0, len(ufs)))],
                "quantidade": qtd,
                "preco_unitario": f"R$ {preco:,.2f}".replace(",", "X")
                .replace(".", ",")
                .replace("X", "."),
                "valor_total": f"R$ {total:,.2f}".replace(",", "X")
                .replace(".", ",")
                .replace("X", "."),
                "cliente_recorrente": "sim" if rng.random() > 0.4 else "nao",
            }
        )
    frame = pd.DataFrame(rows)
    frame = pd.concat([frame, frame.head(8)], ignore_index=True)  # duplicates
    frame.loc[frame.index[:5], "uf"] = None  # missing values

    buffer = io.StringIO()
    frame.to_csv(buffer, index=False)
    return buffer.getvalue().encode("utf-8")


@pytest.fixture
def uploaded_dataset(auth_client: TestClient, sales_csv: bytes) -> dict:
    response = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("vendas.csv", io.BytesIO(sales_csv), "text/csv")},
    )
    assert response.status_code == 201, response.text
    return response.json()
