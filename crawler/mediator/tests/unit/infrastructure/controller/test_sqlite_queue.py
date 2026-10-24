from __future__ import annotations

from pathlib import Path

from mediator.infrastructure.controller.sqlite_queue import SqliteUrlQueue


def test_sqlite_queue_survives_reopen(tmp_path: Path) -> None:
    path = tmp_path / "q.sqlite3"
    queue = SqliteUrlQueue(path)
    assert queue.add([("https://a/1", "a", "page"), ("https://a/1", "a", "page")], 1.0) == [
        "https://a/1"
    ]
    queue.mark_sent("https://a/1", 2.0, 50.0)
    queue.close()
    reopened = SqliteUrlQueue(path)
    assert reopened.counts(10.0).total == 1
    row = reopened.next_due(60.0, 1.0)
    assert row is not None
    assert (row.last_sent_at, row.next_due_at, row.kind) == (2.0, 50.0, "page")


def test_sqlite_next_due_skips_cooling_host(tmp_path: Path) -> None:
    queue = SqliteUrlQueue(tmp_path / "q.sqlite3")
    queue.add(
        [("https://a/1", "a", "page"), ("https://a/2", "a", "page"), ("https://b/1", "b", "hub")],
        0.0,
    )
    queue.mark_sent("https://a/1", 10.0, None)
    row = queue.next_due(10.5, 1.0)
    assert row is not None and row.host == "b"
    row = queue.next_due(11.0, 1.0)
    assert row is not None and row.url in {"https://a/2", "https://b/1"}


def test_sqlite_never_due_and_failures(tmp_path: Path) -> None:
    queue = SqliteUrlQueue(tmp_path / "q.sqlite3")
    queue.add([("https://a/1", "a", "page")], 0.0)
    queue.mark_failed("https://a/1", 3, 5.0)
    assert queue.next_due(4.0, 0.0) is None
    row = queue.next_due(5.0, 0.0)
    assert row is not None and row.attempts == 3
    queue.mark_sent("https://a/1", 6.0, None)
    assert queue.next_due(1e12, 0.0) is None
    assert queue.counts(1e12).due == 0
