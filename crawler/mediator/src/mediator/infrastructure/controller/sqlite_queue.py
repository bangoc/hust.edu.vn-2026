from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from mediator.application.controller.ports import QueueCounts
from mediator.domain.controller.models import QueuedUrl, UrlKind
from mediator.infrastructure.shared.sqlite import connect, transaction

_SCHEMA = """
CREATE TABLE IF NOT EXISTS urls (
    url TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    kind TEXT NOT NULL,
    next_due_at REAL,
    last_sent_at REAL,
    attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS urls_next_due ON urls (next_due_at);
CREATE TABLE IF NOT EXISTS hosts (
    host TEXT PRIMARY KEY,
    last_sent_at REAL NOT NULL
);
"""


class SqliteUrlQueue:
    """The ``UrlQueue`` port over one SQLite file; every write commits at once."""

    def __init__(self, path: Path) -> None:
        self.db = connect(path)
        self.db.executescript(_SCHEMA)

    def close(self) -> None:
        self.db.close()

    def add(self, items: Sequence[tuple[str, str, UrlKind]], now: float) -> int:
        before = self.db.total_changes
        with transaction(self.db):
            self.db.executemany(
                "INSERT OR IGNORE INTO urls (url, host, kind, next_due_at) VALUES (?, ?, ?, ?)",
                [(url, host, kind, now) for url, host, kind in items],
            )
        return self.db.total_changes - before

    def next_due(self, now: float, host_delay_seconds: float) -> QueuedUrl | None:
        row = self.db.execute(
            """
            SELECT u.url, u.host, u.kind, u.next_due_at, u.last_sent_at, u.attempts
            FROM urls u LEFT JOIN hosts h ON h.host = u.host
            WHERE u.next_due_at <= ? AND (h.last_sent_at IS NULL OR h.last_sent_at + ? <= ?)
            ORDER BY u.next_due_at
            LIMIT 1
            """,
            (now, host_delay_seconds, now),
        ).fetchone()
        return QueuedUrl(*row) if row else None

    def mark_sent(self, url: str, now: float, next_due_at: float | None) -> None:
        with transaction(self.db):
            self.db.execute(
                "UPDATE urls SET last_sent_at = ?, next_due_at = ?, attempts = 0 WHERE url = ?",
                (now, next_due_at, url),
            )
            self.db.execute(
                "INSERT INTO hosts (host, last_sent_at) SELECT host, ? FROM urls WHERE url = ? "
                "ON CONFLICT (host) DO UPDATE SET last_sent_at = excluded.last_sent_at",
                (now, url),
            )

    def mark_failed(self, url: str, attempts: int, next_due_at: float | None) -> None:
        self.db.execute(
            "UPDATE urls SET attempts = ?, next_due_at = ? WHERE url = ?",
            (attempts, next_due_at, url),
        )

    def counts(self, now: float) -> QueueCounts:
        total, due = self.db.execute(
            "SELECT COUNT(*), COALESCE(SUM(next_due_at <= ?), 0) FROM urls", (now,)
        ).fetchone()
        return QueueCounts(total=total, due=due)
