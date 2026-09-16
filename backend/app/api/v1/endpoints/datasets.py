"""Dataset endpoints: upload, listing, profiling, quality and raw rows."""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile, status
from sqlalchemy import func, select

from app.ai.analyst import DataAnalyst
from app.api.deps import CurrentUser, DbSession, OwnedDataset, ReadyDataset, load_dataset_frame
from app.core.config import settings
from app.core.errors import FileTooLargeError, UnprocessableDatasetError, ValidationError
from app.models import Dashboard, Dataset, DatasetStatus
from app.schemas.common import MessageResponse
from app.schemas.dataset import (
    DatasetDetail,
    DatasetRowsResponse,
    DatasetSummary,
    RenameDatasetRequest,
    UploadResponse,
)
from app.services import analyzer, dashboard_builder, profiling, storage

router = APIRouter(prefix="/datasets", tags=["datasets"])
logger = logging.getLogger(__name__)

_ALLOWED_CONTENT_TYPES = {
    "text/csv", "application/csv", "text/plain", "application/vnd.ms-excel",
    "application/octet-stream", "text/tab-separated-values",
}
_ALLOWED_EXTENSIONS = (".csv", ".tsv", ".txt")
_UPLOAD_CHUNK = 1024 * 1024


async def _read_upload(file: UploadFile) -> bytes:
    """Stream the upload, aborting as soon as the size limit is exceeded."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > settings.max_upload_bytes:
            raise FileTooLargeError(
                f"O arquivo excede o limite de "
                f"{settings.max_upload_bytes // (1024 * 1024)} MB."
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _validate_upload(file: UploadFile) -> None:
    filename = (file.filename or "").strip()
    if not filename:
        raise ValidationError("Nenhum arquivo foi enviado.")
    if not filename.lower().endswith(_ALLOWED_EXTENSIONS):
        raise ValidationError(
            "Formato não suportado. Envie um arquivo .csv, .tsv ou .txt."
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
        raise ValidationError(f"Tipo de conteúdo não suportado: {content_type}.")


def _safe_name(filename: str) -> str:
    """Derive a display name from the upload without trusting the path."""
    base = filename.replace("\\", "/").split("/")[-1]
    stem = base.rsplit(".", 1)[0] if "." in base else base
    cleaned = "".join(ch for ch in stem if ch.isprintable()).strip()
    return (cleaned or "Conjunto de dados")[:200]


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    user: CurrentUser,
    db: DbSession,
    file: Annotated[UploadFile, File(description="Arquivo CSV")],
) -> UploadResponse:
    """Upload a CSV, run the full analysis pipeline and generate a dashboard."""
    _validate_upload(file)
    raw = await _read_upload(file)

    dataset = Dataset(
        user_id=user.id,
        name=_safe_name(file.filename or "dataset.csv"),
        original_filename=(file.filename or "dataset.csv")[:255],
        storage_path="",
        status=DatasetStatus.PROCESSING,
        size_bytes=len(raw),
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    try:
        bundle = analyzer.analyse_csv_bytes(raw, filename=dataset.original_filename)
    except UnprocessableDatasetError as exc:
        dataset.status = DatasetStatus.FAILED
        dataset.error_message = exc.message
        db.commit()
        raise
    except Exception as exc:  # pragma: no cover - unexpected parser failure
        logger.exception("Falha inesperada ao analisar o conjunto de dados %s", dataset.id)
        dataset.status = DatasetStatus.FAILED
        dataset.error_message = "Falha inesperada ao processar o arquivo."
        db.commit()
        raise UnprocessableDatasetError(
            "Não foi possível processar este arquivo. Verifique o formato e tente novamente."
        ) from exc

    path = storage.save_dataframe(user.id, dataset.id, bundle.frame)

    dataset.storage_path = str(path)
    dataset.status = DatasetStatus.READY
    dataset.row_count = bundle.profile["overview"]["row_count"]
    dataset.column_count = bundle.profile["overview"]["column_count"]
    dataset.quality_score = bundle.quality_score
    dataset.domain = bundle.domain_key
    dataset.profile = bundle.profile
    dataset.semantics = bundle.semantics
    dataset.analysis = bundle.analysis
    dataset.error_message = None
    db.commit()
    db.refresh(dataset)

    dashboard = await _generate_dashboard(db, user_id=user.id, dataset=dataset)

    return UploadResponse(
        dataset=DatasetDetail.model_validate(dataset),
        dashboard_id=dashboard.id if dashboard else None,
        warnings=bundle.warnings,
    )


async def _generate_dashboard(db, *, user_id: str, dataset: Dataset) -> Dashboard | None:
    """Run AI curation and persist the generated dashboard."""
    analyst = DataAnalyst()
    analysis = dataset.analysis
    profile = dataset.profile

    try:
        curated, meta = await analyst.curate_dashboard(
            analysis.get("recommendations", []), profile, analysis
        )
        narrative = await analyst.summarise_dashboard(profile, analysis)
    except Exception:  # pragma: no cover - the dashboard must still be created
        logger.exception("Curadoria via IA falhou; usando saída determinística.")
        curated = analysis.get("recommendations", [])
        meta = {"title": None, "subtitle": None}
        narrative = analyst._template_summary(profile, analysis)

    spec = dashboard_builder.build_dashboard_spec(
        profile=profile,
        analysis=analysis,
        recommendations=curated,
        kpis=analysis.get("kpis", []),
        narrative=narrative,
        title=meta.get("title") or f"Dashboard · {dataset.name}",
        subtitle=meta.get("subtitle"),
    )

    dashboard = Dashboard(
        user_id=user_id,
        dataset_id=dataset.id,
        name=spec["title"],
        description=spec.get("subtitle", ""),
        spec=spec,
        is_primary=True,
    )
    db.add(dashboard)
    db.commit()
    db.refresh(dashboard)
    return dashboard


@router.get("", response_model=list[DatasetSummary])
def list_datasets(
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DatasetSummary]:
    rows = db.scalars(
        select(Dataset)
        .where(Dataset.user_id == user.id)
        .order_by(Dataset.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [DatasetSummary.model_validate(r) for r in rows]


@router.get("/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset: OwnedDataset) -> DatasetDetail:
    return DatasetDetail.model_validate(dataset)


@router.patch("/{dataset_id}", response_model=DatasetSummary)
def rename_dataset(
    payload: RenameDatasetRequest, dataset: OwnedDataset, db: DbSession
) -> DatasetSummary:
    dataset.name = payload.name.strip()[:200]
    db.commit()
    db.refresh(dataset)
    return DatasetSummary.model_validate(dataset)


@router.delete("/{dataset_id}", response_model=MessageResponse)
def delete_dataset(dataset: OwnedDataset, db: DbSession) -> MessageResponse:
    storage.delete_dataset(dataset.user_id, dataset.id)
    db.delete(dataset)
    db.commit()
    return MessageResponse(message="Conjunto de dados removido.")


@router.get("/{dataset_id}/profile")
def get_profile(dataset: ReadyDataset) -> dict:
    return dataset.profile


@router.get("/{dataset_id}/quality")
def get_quality(dataset: ReadyDataset) -> dict:
    return dataset.analysis.get("quality", {})


@router.get("/{dataset_id}/insights")
def get_insights(dataset: ReadyDataset) -> dict:
    analysis = dataset.analysis
    return {
        "insights": analysis.get("insights", []),
        "anomalies": analysis.get("anomalies", []),
        "domain": analysis.get("domain", {}),
    }


@router.get("/{dataset_id}/rows", response_model=DatasetRowsResponse)
def get_rows(
    dataset: ReadyDataset,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DatasetRowsResponse:
    """Paged access to raw rows — the table widget never loads the whole file."""
    frame = load_dataset_frame(dataset)
    rows = profiling.sample_rows(frame, limit=limit, offset=offset)
    return DatasetRowsResponse(
        columns=list(frame.columns),
        rows=rows,
        total=int(len(frame)),
        limit=limit,
        offset=offset,
    )


@router.post("/{dataset_id}/reanalyse", response_model=DatasetDetail)
def reanalyse(dataset: ReadyDataset, db: DbSession) -> DatasetDetail:
    """Re-run the analysis pipeline over the stored dataset."""
    from app.services import semantics as sem

    frame = load_dataset_frame(dataset)
    typed_frame, column_semantics = sem.analyse_schema(frame)
    bundle = analyzer.analyse_frame(typed_frame, column_semantics)

    dataset.profile = bundle.profile
    dataset.semantics = bundle.semantics
    dataset.analysis = bundle.analysis
    dataset.quality_score = bundle.quality_score
    dataset.domain = bundle.domain_key
    db.commit()
    db.refresh(dataset)
    return DatasetDetail.model_validate(dataset)


@router.get("/stats/overview")
def workspace_stats(user: CurrentUser, db: DbSession) -> dict:
    """Counters for the workspace home screen."""
    dataset_count = db.scalar(
        select(func.count()).select_from(Dataset).where(Dataset.user_id == user.id)
    )
    dashboard_count = db.scalar(
        select(func.count()).select_from(Dashboard).where(Dashboard.user_id == user.id)
    )
    total_rows = db.scalar(
        select(func.coalesce(func.sum(Dataset.row_count), 0)).where(Dataset.user_id == user.id)
    )
    avg_quality = db.scalar(
        select(func.avg(Dataset.quality_score)).where(
            Dataset.user_id == user.id, Dataset.status == DatasetStatus.READY
        )
    )
    return {
        "datasets": int(dataset_count or 0),
        "dashboards": int(dashboard_count or 0),
        "total_rows": int(total_rows or 0),
        "average_quality": round(float(avg_quality), 1) if avg_quality else 0.0,
    }
