"""End-to-end API behaviour: auth, upload, dashboards, chat, explore, export."""
from __future__ import annotations

import copy
import io

from fastapi.testclient import TestClient

# --- Auth -----------------------------------------------------------------

def test_register_login_and_me(client: TestClient):
    payload = {"email": "novo@exemplo.com", "password": "SenhaSegura123", "full_name": "Novo"}
    created = client.post("/api/v1/auth/register", json=payload)
    assert created.status_code == 201
    assert created.json()["user"]["email"] == "novo@exemplo.com"

    duplicate = client.post("/api/v1/auth/register", json=payload)
    assert duplicate.status_code == 409

    logged = client.post(
        "/api/v1/auth/login", json={"email": "novo@exemplo.com", "password": "SenhaSegura123"}
    )
    assert logged.status_code == 200
    token = logged.json()["access_token"]

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "novo@exemplo.com"


def test_login_with_wrong_password_fails(client: TestClient):
    client.post(
        "/api/v1/auth/register",
        json={"email": "senha@exemplo.com", "password": "SenhaSegura123"},
    )
    response = client.post(
        "/api/v1/auth/login", json={"email": "senha@exemplo.com", "password": "ErradaErrada1"}
    )
    assert response.status_code == 401


def test_weak_password_is_rejected(client: TestClient):
    response = client.post(
        "/api/v1/auth/register", json={"email": "fraca@exemplo.com", "password": "abc"}
    )
    assert response.status_code == 422


def test_protected_route_requires_token(client: TestClient):
    client.headers.pop("Authorization", None)
    assert client.get("/api/v1/datasets").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer lixo"}).status_code == 401


def test_password_reset_flow(client: TestClient):
    client.post(
        "/api/v1/auth/register",
        json={"email": "reset@exemplo.com", "password": "SenhaSegura123"},
    )
    forgot = client.post("/api/v1/auth/forgot-password", json={"email": "reset@exemplo.com"})
    assert forgot.status_code == 200
    token = forgot.json()["message"].split("token: ")[-1].strip()

    reset = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "NovaSenha456"}
    )
    assert reset.status_code == 200

    # The old password no longer works and the token cannot be replayed.
    assert client.post(
        "/api/v1/auth/login", json={"email": "reset@exemplo.com", "password": "SenhaSegura123"}
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/login", json={"email": "reset@exemplo.com", "password": "NovaSenha456"}
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "Outra123456"}
    ).status_code == 422


def test_forgot_password_does_not_reveal_registration(client: TestClient):
    response = client.post(
        "/api/v1/auth/forgot-password", json={"email": "inexistente@exemplo.com"}
    )
    assert response.status_code == 200
    assert "token" not in response.json()["message"]


# --- Upload ---------------------------------------------------------------

def test_upload_produces_dataset_and_dashboard(uploaded_dataset: dict):
    dataset = uploaded_dataset["dataset"]
    assert dataset["status"] == "ready"
    assert dataset["row_count"] > 0
    assert dataset["domain"] == "sales"
    assert 0 < dataset["quality_score"] <= 100
    assert uploaded_dataset["dashboard_id"]

    analysis = dataset["analysis"]
    assert analysis["recommendations"]
    assert analysis["kpis"]
    assert analysis["insights"]


def test_upload_rejects_non_csv(auth_client: TestClient):
    response = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("imagem.png", io.BytesIO(b"\x89PNG\r\n"), "image/png")},
    )
    assert response.status_code == 422


def test_upload_rejects_unparseable_content(auth_client: TestClient):
    response = auth_client.post(
        "/api/v1/datasets",
        files={"file": ("vazio.csv", io.BytesIO(b""), "text/csv")},
    )
    assert response.status_code == 422
    assert response.json()["code"] in {"unprocessable_dataset", "validation_error"}


def test_dataset_rows_are_paginated(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.get(f"/api/v1/datasets/{dataset_id}/rows?limit=10&offset=5")
    assert response.status_code == 200
    body = response.json()
    assert len(body["rows"]) == 10
    assert body["total"] > 10


def test_datasets_are_isolated_between_users(
    client: TestClient, auth_client: TestClient, uploaded_dataset: dict
):
    dataset_id = uploaded_dataset["dataset"]["id"]
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "intruso@exemplo.com", "password": "SenhaSegura123"},
    ).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}

    # Another user's dataset is reported as missing, never as forbidden.
    assert client.get(f"/api/v1/datasets/{dataset_id}", headers=headers).status_code == 404
    assert client.get(f"/api/v1/datasets/{dataset_id}/rows", headers=headers).status_code == 404
    assert client.delete(f"/api/v1/datasets/{dataset_id}", headers=headers).status_code == 404
    assert client.get("/api/v1/datasets", headers=headers).json() == []


# --- Dashboards -----------------------------------------------------------

def test_generated_dashboard_has_widgets(auth_client: TestClient, uploaded_dataset: dict):
    response = auth_client.get(f"/api/v1/dashboards/{uploaded_dataset['dashboard_id']}")
    assert response.status_code == 200
    spec = response.json()["spec"]
    assert spec["widgets"]
    kinds = {w["type"] for w in spec["widgets"]}
    assert "kpi" in kinds
    assert "chart" in kinds
    for widget in spec["widgets"]:
        assert widget["id"]
        assert "layout" in widget and {"x", "y", "w", "h"} <= widget["layout"].keys()


def test_dashboard_update_and_versioning(auth_client: TestClient, uploaded_dataset: dict):
    dashboard_id = uploaded_dataset["dashboard_id"]
    original = auth_client.get(f"/api/v1/dashboards/{dashboard_id}").json()
    original_title = original["spec"]["title"]
    spec = copy.deepcopy(original["spec"])
    spec["title"] = "Meu dashboard editado"

    updated = auth_client.patch(
        f"/api/v1/dashboards/{dashboard_id}",
        json={"spec": spec, "name": "Editado", "save_version": True, "version_label": "v1"},
    )
    assert updated.status_code == 200
    assert updated.json()["spec"]["title"] == "Meu dashboard editado"

    versions = auth_client.get(f"/api/v1/dashboards/{dashboard_id}/versions").json()
    assert len(versions) == 1

    restored = auth_client.post(
        f"/api/v1/dashboards/{dashboard_id}/versions/{versions[0]['id']}/restore"
    )
    assert restored.status_code == 200
    assert restored.json()["spec"]["title"] == original_title


def test_dashboard_rejects_oversized_spec(auth_client: TestClient, uploaded_dataset: dict):
    dashboard_id = uploaded_dataset["dashboard_id"]
    response = auth_client.patch(
        f"/api/v1/dashboards/{dashboard_id}",
        json={"spec": {"widgets": [{"type": "chart"} for _ in range(200)]}},
    )
    assert response.status_code == 422


def test_widget_data_returns_real_rows(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data",
        json={
            "chart_type": "bar",
            "encoding": {"x": "produto", "y": "valor_total", "agg": "sum"},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["rows"]
    assert "produto" in body["columns"]
    assert all(row["valor_total"] > 0 for row in body["rows"])


def test_widget_data_rejects_unknown_column(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data",
        json={"chart_type": "bar", "encoding": {"x": "coluna_inexistente", "agg": "sum"}},
    )
    assert response.status_code == 422
    assert "available_columns" in response.json()["details"]


def test_widget_filters_change_the_result(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    body = {"chart_type": "bar", "encoding": {"x": "produto", "y": "valor_total", "agg": "sum"}}
    unfiltered = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data", json=body
    ).json()
    filtered = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data",
        json={**body, "filters": [{"column": "uf", "op": "eq", "value": "SP"}]},
    ).json()
    total_unfiltered = sum(r["valor_total"] for r in unfiltered["rows"])
    total_filtered = sum(r["valor_total"] for r in filtered["rows"])
    assert total_filtered < total_unfiltered


# --- Explore --------------------------------------------------------------

def test_explore_fields_and_query(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    fields = auth_client.get(f"/api/v1/datasets/{dataset_id}/explore/fields").json()
    assert fields["metrics"] and fields["dimensions"]
    assert "line" in fields["chart_types"]

    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/explore",
        json={"x": "uf", "y": "valor_total", "agg": "sum", "chart_type": "bar", "limit": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["rows"]
    assert body["suggested_chart"]
    assert body["rationale"]


def test_explore_suggests_line_for_temporal_axis(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/explore",
        json={
            "x": "data_pedido", "y": "valor_total", "agg": "sum",
            "time_grain": "month", "chart_type": "line", "limit": 100,
        },
    )
    assert response.json()["suggested_chart"] == "line"


# --- AI analyst -----------------------------------------------------------

def test_ask_returns_grounded_answer(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/ask", json={"question": "Qual produto vendeu mais?"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"]
    assert body["conversation_id"]
    assert body["source"] == "deterministic"  # no API key configured in tests

    # The answer must be backed by an executed plan over real rows.
    assert body["plan"]["group_by"] == ["produto"]
    assert body["result"]["rows"]


def test_ask_generates_a_chart(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    body = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/ask", json={"question": "Mostre as vendas por estado"}
    ).json()
    assert body["chart"] is not None
    assert body["chart"]["inline_data"]["rows"]


def test_conversation_history_is_persisted(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    first = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/ask", json={"question": "Qual produto vendeu mais?"}
    ).json()
    conversation_id = first["conversation_id"]
    auth_client.post(
        f"/api/v1/datasets/{dataset_id}/ask",
        json={"question": "E por estado?", "conversation_id": conversation_id},
    )
    detail = auth_client.get(f"/api/v1/conversations/{conversation_id}").json()
    assert len(detail["messages"]) == 4  # 2 perguntas + 2 respostas


def test_suggested_questions_reflect_the_dataset(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    body = auth_client.get(f"/api/v1/datasets/{dataset_id}/suggested-questions").json()
    assert len(body["questions"]) >= 4
    assert body["domain"] == "Vendas"


def test_ai_status_reports_deterministic_mode(auth_client: TestClient):
    body = auth_client.get("/api/v1/ai/status").json()
    assert body["mode"] == "deterministic"
    assert body["available"] is False


# --- Export ---------------------------------------------------------------

def test_csv_export_is_formula_injection_safe(auth_client: TestClient, sales_csv: bytes):
    malicious = b'nome,valor\n"=cmd|calc",10\n"@SUM(1)",20\n'
    dataset = auth_client.post(
        "/api/v1/datasets", files={"file": ("mal.csv", io.BytesIO(malicious), "text/csv")}
    ).json()["dataset"]

    response = auth_client.get(f"/api/v1/datasets/{dataset['id']}/export/csv")
    assert response.status_code == 200
    text = response.text
    for line in text.splitlines()[1:]:
        first_cell = line.split(",")[0].strip('"')
        assert not first_cell.startswith(("=", "@")), f"célula executável exportada: {first_cell}"


def test_report_export_contains_computed_numbers(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.get(f"/api/v1/datasets/{dataset_id}/export/report")
    assert response.status_code == 200
    markdown = response.text
    assert "Relatório de insights" in markdown
    assert "Qualidade dos dados" in markdown
    assert str(uploaded_dataset["dataset"]["quality_score"]) in markdown


def test_health_endpoint(client: TestClient):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert "llm" in body


# --- Dashboard spec integrity ---------------------------------------------

def test_kpi_widgets_carry_their_own_label(auth_client: TestClient, uploaded_dataset: dict):
    """The KPI card renders from config.kpi alone, so the label must be there."""
    spec = auth_client.get(f"/api/v1/dashboards/{uploaded_dataset['dashboard_id']}").json()["spec"]
    kpis = [w for w in spec["widgets"] if w["type"] == "kpi"]
    assert kpis, "nenhum KPI no dashboard gerado"
    for widget in kpis:
        payload = widget["config"]["kpi"]
        assert payload["label"], f"KPI {widget['id']} sem rótulo"
        assert payload["value"] is not None
        assert payload["format"] in {"currency", "percent", "integer", "decimal"}


def test_every_widget_declares_a_usable_layout(auth_client: TestClient, uploaded_dataset: dict):
    spec = auth_client.get(f"/api/v1/dashboards/{uploaded_dataset['dashboard_id']}").json()["spec"]
    columns = spec["grid"]["columns"]
    for widget in spec["widgets"]:
        layout = widget["layout"]
        assert 1 <= layout["w"] <= columns, f"{widget['id']} com largura inválida"
        assert 1 <= layout["h"] <= 6, f"{widget['id']} com altura inválida"


def test_chart_widgets_reference_real_columns(auth_client: TestClient, uploaded_dataset: dict):
    """A widget encoding a column that does not exist would render an error."""
    dataset = uploaded_dataset["dataset"]
    names = {c["name"] for c in dataset["profile"]["columns"]}
    spec = auth_client.get(f"/api/v1/dashboards/{uploaded_dataset['dashboard_id']}").json()["spec"]

    for widget in spec["widgets"]:
        if widget["type"] != "chart":
            continue
        encoding = widget["config"]["encoding"]
        for key in ("x", "y", "series"):
            column = encoding.get(key)
            if column:
                assert column in names, f"{widget['id']} referencia coluna inexistente: {column}"


def test_non_additive_metrics_are_never_summed_in_the_dashboard(
    auth_client: TestClient, uploaded_dataset: dict
):
    dataset = uploaded_dataset["dataset"]
    additive = {
        c["name"]: (c.get("detail") or {}).get("additive", True)
        for c in dataset["profile"]["columns"]
    }
    spec = auth_client.get(f"/api/v1/dashboards/{uploaded_dataset['dashboard_id']}").json()["spec"]

    for widget in spec["widgets"]:
        encoding = widget["config"].get("encoding") or {}
        column, agg = encoding.get("y"), encoding.get("agg")
        if column and agg == "sum":
            assert additive.get(column, True), (
                f"{widget['id']} soma “{column}”, que não é uma medida aditiva"
            )
        kpi = widget["config"].get("kpi")
        if kpi and kpi.get("agg") == "sum" and kpi.get("column"):
            assert additive.get(kpi["column"], True), (
                f"KPI soma “{kpi['column']}”, que não é uma medida aditiva"
            )


# --- Security --------------------------------------------------------------

def test_path_traversal_in_identifiers_is_rejected(auth_client: TestClient):
    """Storage paths derive from validated IDs, never from user-supplied text."""
    for candidate in ["../../etc/passwd", "..%2f..%2fetc", "a" * 40, "'; DROP TABLE users--"]:
        response = auth_client.get(f"/api/v1/datasets/{candidate}")
        assert response.status_code in {404, 422}, f"{candidate} não foi rejeitado"


def test_dataset_rows_of_another_user_are_not_reachable(
    client: TestClient, auth_client: TestClient, uploaded_dataset: dict
):
    dataset_id = uploaded_dataset["dataset"]["id"]
    other = client.post(
        "/api/v1/auth/register",
        json={"email": "outro@exemplo.com", "password": "SenhaSegura123"},
    ).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}

    # Every dataset-scoped route must refuse, including the derived ones.
    for path in [
        f"/api/v1/datasets/{dataset_id}/profile",
        f"/api/v1/datasets/{dataset_id}/quality",
        f"/api/v1/datasets/{dataset_id}/insights",
        f"/api/v1/datasets/{dataset_id}/export/csv",
        f"/api/v1/datasets/{dataset_id}/export/report",
        f"/api/v1/datasets/{dataset_id}/explore/fields",
        f"/api/v1/datasets/{dataset_id}/suggested-questions",
    ]:
        assert client.get(path, headers=headers).status_code == 404, path

    assert client.post(
        f"/api/v1/datasets/{dataset_id}/ask",
        json={"question": "Qual produto vendeu mais?"},
        headers=headers,
    ).status_code == 404
    assert client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data",
        json={"chart_type": "bar", "encoding": {"x": "produto"}},
        headers=headers,
    ).status_code == 404


def test_ai_status_requires_authentication(client: TestClient):
    client.headers.pop("Authorization", None)
    assert client.get("/api/v1/ai/status").status_code == 401


def test_query_limits_are_clamped(auth_client: TestClient, uploaded_dataset: dict):
    """A crafted limit must not turn one request into an unbounded scan."""
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/widget-data",
        json={
            "chart_type": "bar",
            "encoding": {"x": "produto", "y": "valor_total", "agg": "sum"},
            "limit": 10_000_000,
        },
    )
    assert response.status_code == 422  # rejected by the schema bound


def test_ask_rejects_an_oversized_question(auth_client: TestClient, uploaded_dataset: dict):
    dataset_id = uploaded_dataset["dataset"]["id"]
    response = auth_client.post(
        f"/api/v1/datasets/{dataset_id}/ask", json={"question": "a" * 5000}
    )
    assert response.status_code == 422


def test_health_does_not_disclose_the_configured_provider(client: TestClient):
    """The probe is anonymous, so it must not name the model backend."""
    client.headers.pop("Authorization", None)
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert set(body["llm"].keys()) == {"mode"}
    serialised = str(body).lower()
    for leaked in ("anthropic", "openai", "claude", "gpt", "rule-based"):
        assert leaked not in serialised, f"/health expôs “{leaked}”"


def test_progress_is_scoped_to_the_user_who_claimed_the_token():
    """A token is guessable, so reading one must prove ownership — otherwise
    anyone could watch someone else's upload advance."""
    from app.services import progress

    progress.start("tok-abc", "user-1")
    progress.record("tok-abc", "patterns")

    mine = progress.read("tok-abc", "user-1")
    assert mine is not None
    assert mine["stage"] == "patterns"
    assert mine["index"] == progress.STAGE_IDS.index("patterns")

    assert progress.read("tok-abc", "user-2") is None, "vazou para outro usuário"

    progress.finish("tok-abc")
    assert progress.read("tok-abc", "user-1") is None


def test_progress_endpoint_answers_for_an_unknown_token(auth_client):
    """An upload that has not reached the server yet, or already returned, is
    not an error state — the client just keeps waiting."""
    response = auth_client.get("/api/v1/datasets/progress/nao-existe")
    assert response.status_code == 200
    body = response.json()
    assert body["stage"] is None
    assert body["total"] == 7


def test_upload_reports_real_progress_stages(auth_client):
    """End to end: the token travels with the upload and the pipeline fills it."""
    from app.services import progress

    csv = b"data,uf,valor_total\n2024-01-05,SP,1200.50\n2024-02-11,RJ,980.00\n" * 40
    seen: list[str] = []
    original = progress.record

    def spy(token: str, stage: str) -> None:
        seen.append(stage)
        original(token, stage)

    progress.record = spy
    try:
        response = auth_client.post(
            "/api/v1/datasets",
            files={"file": ("vendas.csv", csv, "text/csv")},
            data={"progress_token": "tok-upload"},
        )
    finally:
        progress.record = original

    assert response.status_code == 201, response.text
    assert "read" in seen and "build" in seen, seen
    # The token is released once the upload has answered.
    assert progress.read("tok-upload", "irrelevante") is None
