"""Dashboard endpoints: CRUD, versioning and widget data."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api.deps import (
    CurrentUser,
    DbSession,
    OwnedDashboard,
    ReadyDataset,
    load_dataset_frame,
)
from app.core.errors import NotFoundError, ValidationError
from app.models import Dashboard, DashboardVersion, Dataset, DatasetStatus
from app.schemas.common import MessageResponse
from app.schemas.dashboard import (
    CreateDashboardRequest,
    DashboardDetail,
    DashboardSummary,
    DashboardVersionSummary,
    UpdateDashboardRequest,
    WidgetDataRequest,
    WidgetDataResponse,
)
from app.services import dashboard_builder, widget_data

router = APIRouter(tags=["dashboards"])

_MAX_WIDGETS = 60
_MAX_VERSIONS = 30


def _validate_spec(spec: dict) -> dict:
    """Bound the spec so a crafted payload cannot exhaust memory or storage."""
    if not isinstance(spec, dict):
        raise ValidationError("A especificação do dashboard deve ser um objeto.")
    widgets = spec.get("widgets")
    if widgets is not None:
        if not isinstance(widgets, list):
            raise ValidationError("“widgets” deve ser uma lista.")
        if len(widgets) > _MAX_WIDGETS:
            raise ValidationError(f"Um dashboard suporta no máximo {_MAX_WIDGETS} widgets.")
        for widget in widgets:
            if not isinstance(widget, dict):
                raise ValidationError("Cada widget deve ser um objeto.")
            if not widget.get("id"):
                widget["id"] = dashboard_builder.next_widget_id()
    return spec


@router.get("/dashboards", response_model=list[DashboardSummary])
def list_dashboards(
    user: CurrentUser,
    db: DbSession,
    dataset_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[DashboardSummary]:
    query = select(Dashboard).where(Dashboard.user_id == user.id)
    if dataset_id:
        query = query.where(Dashboard.dataset_id == dataset_id)
    rows = db.scalars(query.order_by(Dashboard.updated_at.desc()).limit(limit)).all()
    return [DashboardSummary.model_validate(r) for r in rows]


@router.post("/dashboards", response_model=DashboardDetail, status_code=status.HTTP_201_CREATED)
def create_dashboard(
    payload: CreateDashboardRequest, user: CurrentUser, db: DbSession
) -> DashboardDetail:
    dataset = db.get(Dataset, payload.dataset_id)
    if dataset is None or dataset.user_id != user.id:
        raise NotFoundError("Conjunto de dados não encontrado.")
    if dataset.status != DatasetStatus.READY:
        raise ValidationError("O conjunto de dados ainda não está pronto.")

    spec = _validate_spec(payload.spec) if payload.spec else {
        "version": dashboard_builder.SPEC_VERSION,
        "title": payload.name,
        "subtitle": "",
        "theme": user.preferred_theme,
        "grid": {"columns": 12, "rowHeight": 132, "gap": 16},
        "filters": [],
        "widgets": [],
        "meta": {"generated": False},
    }

    dashboard = Dashboard(
        user_id=user.id,
        dataset_id=dataset.id,
        name=payload.name,
        spec=spec,
        theme=spec.get("theme", user.preferred_theme),
    )
    db.add(dashboard)
    db.commit()
    db.refresh(dashboard)
    return DashboardDetail.model_validate(dashboard)


@router.get("/dashboards/{dashboard_id}", response_model=DashboardDetail)
def get_dashboard(dashboard: OwnedDashboard) -> DashboardDetail:
    return DashboardDetail.model_validate(dashboard)


@router.patch("/dashboards/{dashboard_id}", response_model=DashboardDetail)
def update_dashboard(
    payload: UpdateDashboardRequest, dashboard: OwnedDashboard, db: DbSession
) -> DashboardDetail:
    if payload.save_version:
        _snapshot(db, dashboard, payload.version_label)

    if payload.name is not None:
        dashboard.name = payload.name.strip()[:200]
    if payload.description is not None:
        dashboard.description = payload.description[:2000]
    if payload.theme is not None:
        dashboard.theme = payload.theme.strip()[:32]
    if payload.spec is not None:
        spec = _validate_spec(payload.spec)
        if payload.theme is not None:
            spec["theme"] = dashboard.theme
        dashboard.spec = spec

    db.commit()
    db.refresh(dashboard)
    return DashboardDetail.model_validate(dashboard)


@router.delete("/dashboards/{dashboard_id}", response_model=MessageResponse)
def delete_dashboard(dashboard: OwnedDashboard, db: DbSession) -> MessageResponse:
    db.delete(dashboard)
    db.commit()
    return MessageResponse(message="Dashboard removido.")


def _snapshot(db, dashboard: Dashboard, label: str = "") -> DashboardVersion:
    """Persist the current spec as a restorable version."""
    latest = db.scalar(
        select(func.max(DashboardVersion.version)).where(
            DashboardVersion.dashboard_id == dashboard.id
        )
    )
    version = DashboardVersion(
        dashboard_id=dashboard.id,
        version=int(latest or 0) + 1,
        label=(label or f"Versão {int(latest or 0) + 1}")[:200],
        spec=dashboard.spec,
    )
    db.add(version)
    db.flush()

    # Keep history bounded so a heavily edited dashboard cannot grow forever.
    surplus = db.scalars(
        select(DashboardVersion)
        .where(DashboardVersion.dashboard_id == dashboard.id)
        .order_by(DashboardVersion.version.desc())
        .offset(_MAX_VERSIONS)
    ).all()
    for old in surplus:
        db.delete(old)
    return version


@router.post(
    "/dashboards/{dashboard_id}/versions",
    response_model=DashboardVersionSummary,
    status_code=status.HTTP_201_CREATED,
)
def save_version(
    dashboard: OwnedDashboard, db: DbSession, label: Annotated[str, Query(max_length=200)] = ""
) -> DashboardVersionSummary:
    version = _snapshot(db, dashboard, label)
    db.commit()
    db.refresh(version)
    return DashboardVersionSummary.model_validate(version)


@router.get("/dashboards/{dashboard_id}/versions", response_model=list[DashboardVersionSummary])
def list_versions(dashboard: OwnedDashboard, db: DbSession) -> list[DashboardVersionSummary]:
    rows = db.scalars(
        select(DashboardVersion)
        .where(DashboardVersion.dashboard_id == dashboard.id)
        .order_by(DashboardVersion.version.desc())
    ).all()
    return [DashboardVersionSummary.model_validate(r) for r in rows]


@router.post("/dashboards/{dashboard_id}/versions/{version_id}/restore",
             response_model=DashboardDetail)
def restore_version(
    version_id: str, dashboard: OwnedDashboard, db: DbSession
) -> DashboardDetail:
    version = db.get(DashboardVersion, version_id)
    if version is None or version.dashboard_id != dashboard.id:
        raise NotFoundError("Versão não encontrada.")
    # Snapshot first so restoring is itself reversible.
    _snapshot(db, dashboard, "Antes de restaurar")
    dashboard.spec = version.spec
    db.commit()
    db.refresh(dashboard)
    return DashboardDetail.model_validate(dashboard)


@router.post("/datasets/{dataset_id}/widget-data", response_model=WidgetDataResponse)
def widget_data_endpoint(
    payload: WidgetDataRequest, dataset: ReadyDataset
) -> WidgetDataResponse:
    """Resolve the rows backing one widget, with dashboard filters applied."""
    frame = load_dataset_frame(dataset)
    result = widget_data.resolve(
        frame,
        dataset.profile,
        dataset.analysis,
        chart_type=payload.chart_type,
        encoding=payload.encoding,
        filters=[f if isinstance(f, dict) else f.model_dump() for f in payload.filters],
        limit=payload.limit,
    )
    return WidgetDataResponse(**result)


@router.post("/datasets/{dataset_id}/dashboards/generate", response_model=DashboardDetail,
             status_code=status.HTTP_201_CREATED)
async def regenerate_dashboard(
    dataset: ReadyDataset, user: CurrentUser, db: DbSession
) -> DashboardDetail:
    """Generate a fresh AI dashboard for a dataset that already has one."""
    from app.api.v1.endpoints.datasets import _generate_dashboard

    dashboard = await _generate_dashboard(db, user_id=user.id, dataset=dataset)
    if dashboard is None:  # pragma: no cover - builder always returns one
        raise ValidationError("Não foi possível gerar o dashboard.")
    dashboard.is_primary = False
    dashboard.name = f"{dashboard.name} (novo)"
    db.commit()
    db.refresh(dashboard)
    return DashboardDetail.model_validate(dashboard)
