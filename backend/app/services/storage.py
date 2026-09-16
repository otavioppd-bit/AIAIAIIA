"""Dataset persistence and cached loading.

Datasets are stored as Parquet (columnar, typed, compressed) under a
per-user directory. Paths are derived from validated IDs only, never from
user-supplied filenames, so traversal is impossible by construction.
"""
from __future__ import annotations

import re
import threading
from collections import OrderedDict
from pathlib import Path

import pandas as pd

from app.core.config import settings
from app.core.errors import NotFoundError

_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_CACHE_CAPACITY = 8

_cache: OrderedDict[str, pd.DataFrame] = OrderedDict()
_cache_lock = threading.Lock()


def _safe_id(value: str, *, label: str) -> str:
    if not _ID_RE.match(str(value)):
        raise NotFoundError(f"Identificador de {label} inválido.")
    return str(value)


def dataset_path(user_id: str, dataset_id: str) -> Path:
    uid = _safe_id(user_id, label="usuário")
    did = _safe_id(dataset_id, label="conjunto de dados")
    directory = Path(settings.storage_dir) / uid
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{did}.parquet"


def save_dataframe(user_id: str, dataset_id: str, frame: pd.DataFrame) -> Path:
    path = dataset_path(user_id, dataset_id)
    # Parquet cannot store the pandas "string"/"boolean" extension dtypes in
    # every engine version; normalise object-like columns to plain strings.
    to_write = frame.copy()
    for col in to_write.columns:
        if to_write[col].dtype == "string":
            to_write[col] = to_write[col].astype("object")
    to_write.to_parquet(path, index=False, compression="snappy")
    _invalidate(user_id, dataset_id)
    return path


def load_dataframe(user_id: str, dataset_id: str) -> pd.DataFrame:
    """Load a dataset, using a small LRU cache to avoid repeated disk reads."""
    key = f"{user_id}:{dataset_id}"
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached

    path = dataset_path(user_id, dataset_id)
    if not path.exists():
        raise NotFoundError("Os dados deste conjunto não foram encontrados no armazenamento.")
    frame = pd.read_parquet(path)

    with _cache_lock:
        _cache[key] = frame
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_CAPACITY:
            _cache.popitem(last=False)
    return frame


def delete_dataset(user_id: str, dataset_id: str) -> None:
    path = dataset_path(user_id, dataset_id)
    if path.exists():
        path.unlink()
    _invalidate(user_id, dataset_id)


def _invalidate(user_id: str, dataset_id: str) -> None:
    with _cache_lock:
        _cache.pop(f"{user_id}:{dataset_id}", None)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
