"""Live progress for the analysis pipeline.

The upload is a single request, so without this the client can only guess what
the server is doing and animate a plausible-looking sequence. Guessing is
exactly what this product refuses to do with numbers, and progress deserves the
same treatment: the stages the user watches are the stages that actually ran.

State lives in memory. That is the right trade for a single-process deployment —
progress is worthless a few seconds after it is reported, so it never needs to
outlive the request or be shared with another worker. Under multiple workers a
poll can land on a process that never saw the upload; the client treats a silent
token as "still working" and the upload itself is unaffected.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

# The real phases of `analyzer.analyse_frame`, in the order they execute.
# Insights genuinely run before chart selection; the list follows the code
# rather than rearranging itself to look tidier.
STAGES: tuple[tuple[str, str], ...] = (
    ("read", "Lendo o arquivo"),
    ("schema", "Entendendo as colunas"),
    ("patterns", "Detectando padrões"),
    ("relations", "Analisando relações"),
    ("insights", "Gerando insights"),
    ("charts", "Selecionando visualizações"),
    ("build", "Montando o dashboard"),
)

STAGE_IDS = tuple(stage for stage, _ in STAGES)

# A token is only interesting while its upload is in flight.
_TTL_SECONDS = 300
# Bounded so a client looping tokens cannot grow the process without limit.
_MAX_ENTRIES = 512


@dataclass
class _Entry:
    owner_id: str
    stage: str = STAGE_IDS[0]
    updated_at: float = field(default_factory=time.monotonic)
    created_at: float = field(default_factory=time.monotonic)


_entries: dict[str, _Entry] = {}
_lock = threading.Lock()


def _purge(now: float) -> None:
    """Drop expired tokens; called under the lock."""
    stale = [key for key, entry in _entries.items() if now - entry.created_at > _TTL_SECONDS]
    for key in stale:
        _entries.pop(key, None)
    # If a burst still leaves the map oversized, the oldest go first.
    if len(_entries) > _MAX_ENTRIES:
        for key, _ in sorted(_entries.items(), key=lambda item: item[1].created_at)[
            : len(_entries) - _MAX_ENTRIES
        ]:
            _entries.pop(key, None)


def start(token: str, owner_id: str) -> None:
    """Claim a token for one user. Re-claiming resets the sequence."""
    if not token:
        return
    now = time.monotonic()
    with _lock:
        _purge(now)
        _entries[token] = _Entry(owner_id=owner_id)


def record(token: str, stage: str) -> None:
    """Note that `stage` has begun. Unknown tokens are ignored on purpose:
    the analysis must never fail because progress reporting did."""
    if not token or stage not in STAGE_IDS:
        return
    with _lock:
        entry = _entries.get(token)
        if entry is None:
            return
        entry.stage = stage
        entry.updated_at = time.monotonic()


def read(token: str, owner_id: str) -> dict[str, object] | None:
    """Current stage for a token, or None when it is unknown or not yours."""
    with _lock:
        entry = _entries.get(token)
        if entry is None or entry.owner_id != owner_id:
            return None
        index = STAGE_IDS.index(entry.stage)
        return {
            "stage": entry.stage,
            "index": index,
            "total": len(STAGE_IDS),
            "elapsed_ms": int((time.monotonic() - entry.created_at) * 1000),
        }


def finish(token: str) -> None:
    """Release a token once its upload has returned."""
    if not token:
        return
    with _lock:
        _entries.pop(token, None)
