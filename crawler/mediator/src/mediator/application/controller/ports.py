from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from mediator.domain.controller.models import QueuedUrl, UrlKind

type LoadResult = Literal["accepted", "busy", "rejected", "failed"]


@dataclass(frozen=True, slots=True)
class QueueCounts:
    total: int
    due: int


class UrlQueue(Protocol):
    def add(self, items: Sequence[tuple[str, str, UrlKind]], now: float) -> list[str]:
        """Insert ``(url, host, kind)`` rows not yet known, due now; return the new URLs."""
        ...

    def next_due(self, now: float, host_delay_seconds: float) -> QueuedUrl | None:
        """The earliest due URL whose host was last sent to at least ``host_delay_seconds`` ago."""
        ...

    def mark_sent(self, url: str, now: float, next_due_at: float | None) -> None: ...

    def mark_failed(self, url: str, attempts: int, next_due_at: float | None) -> None: ...

    def counts(self, now: float) -> QueueCounts: ...


class Downloader(Protocol):
    async def ping(self, node: str) -> str | None:
        """The node's ``/ping`` status, or ``None`` when it cannot be reached."""
        ...

    async def load(self, node: str, url: str) -> LoadResult:
        """POST to the node's ``/load``: 2xx accepted, 409 busy, 4xx rejected, else failed."""
        ...

    async def close(self) -> None: ...


class Clock(Protocol):
    def now(self) -> float: ...
