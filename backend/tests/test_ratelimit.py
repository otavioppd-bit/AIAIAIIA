"""Rate limiting.

The limiter is disabled in the main suite so tests stay order-independent;
these enable it explicitly against a dedicated app instance.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.ratelimit import limiter
from app.main import app


@pytest.fixture
def limited_client():
    limiter.enabled = True
    limiter.reset()
    with TestClient(app) as client:
        yield client
    limiter.enabled = False
    limiter.reset()


def test_login_attempts_are_rate_limited(limited_client: TestClient):
    """Credential guessing must hit a wall well before it becomes useful."""
    statuses = [
        limited_client.post(
            "/api/v1/auth/login",
            json={"email": "alvo@exemplo.com", "password": f"tentativa{i}"},
        ).status_code
        for i in range(14)
    ]
    assert 429 in statuses, "o login aceitou 14 tentativas seguidas sem limitar"

    blocked = limited_client.post(
        "/api/v1/auth/login", json={"email": "alvo@exemplo.com", "password": "outra"}
    )
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"
    assert "Retry-After" in blocked.headers


def test_registration_is_rate_limited(limited_client: TestClient):
    statuses = [
        limited_client.post(
            "/api/v1/auth/register",
            json={"email": f"spam{i}@exemplo.com", "password": "SenhaSegura123"},
        ).status_code
        for i in range(8)
    ]
    assert 429 in statuses


def test_health_endpoint_is_not_rate_limited(limited_client: TestClient):
    for _ in range(30):
        assert limited_client.get("/health").status_code == 200
