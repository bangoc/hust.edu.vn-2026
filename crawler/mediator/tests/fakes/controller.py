"""In-memory stand-ins for the controller ports."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from mediator.application.controller.ports import LoadResult, QueueCounts
from mediator.domain.controller.models import QueuedUrl, UrlKind


class FakeClock:
    def __init__(self, t: float) -> None:
        self.t = t

    def now(self) -> float:
        return self.t


class FakeUrlQueue:
    def __init__(self) -> None:
        self.rows: dict[str, QueuedUrl] = {}
        self.host_sent: dict[str, float] = {}

    def add(self, items: Sequence[tuple[str, str, UrlKind]], now: float) -> list[str]:
        added: list[str] = []
        for url, host, kind in items:
            if url not in self.rows:
                self.rows[url] = QueuedUrl(url, host, kind, now, None, 0)
                added.append(url)
        return added

    def next_due(self, now: float, host_delay_seconds: float) -> QueuedUrl | None:
        due = [
            row
            for row in self.rows.values()
            if row.next_due_at is not None
            and row.next_due_at <= now
            and self.host_sent.get(row.host, float("-inf")) + host_delay_seconds <= now
        ]
        if not due:
            return None
        return min(due, key=lambda row: row.next_due_at or 0.0)

    def mark_sent(self, url: str, now: float, next_due_at: float | None) -> None:
        row = self.rows[url]
        self.rows[url] = replace(row, next_due_at=next_due_at, last_sent_at=now, attempts=0)
        self.host_sent[row.host] = now

    def mark_failed(self, url: str, attempts: int, next_due_at: float | None) -> None:
        self.rows[url] = replace(self.rows[url], next_due_at=next_due_at, attempts=attempts)

    def counts(self, now: float) -> QueueCounts:
        due = sum(
            1
            for row in self.rows.values()
            if row.next_due_at is not None and row.next_due_at <= now
        )
        return QueueCounts(total=len(self.rows), due=due)


class FakeDownloader:
    """``statuses`` answers ``ping`` (``None`` = unreachable); ``load_results`` answers ``load``."""

    def __init__(
        self, statuses: dict[str, str | None], load_results: dict[str, LoadResult] | None = None
    ) -> None:
        self.statuses = statuses
        self.load_results = load_results or {}
        self.loads: list[tuple[str, str]] = []
        self.pings: list[str] = []

    async def ping(self, node: str) -> str | None:
        self.pings.append(node)
        return self.statuses.get(node)

    async def load(self, node: str, url: str) -> LoadResult:
        result = self.load_results.get(node, "accepted")
        if result == "accepted":
            self.loads.append((node, url))
        return result

    async def close(self) -> None:
        return None
