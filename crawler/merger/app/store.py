"""Lưu trạng thái bằng SQLite: url đã thấy, trang đã lưu, hàng đợi gửi đi (outbox)."""
import json
import os
import sqlite3
import threading
import time

_SCHEMA = """
CREATE TABLE IF NOT EXISTS seen_urls (
    key     TEXT PRIMARY KEY,
    url     TEXT NOT NULL,
    source  TEXT,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
    key     TEXT PRIMARY KEY,
    url     TEXT NOT NULL,
    format  TEXT,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    target     TEXT NOT NULL,          -- 'storage' | 'controller'
    payload    TEXT NOT NULL,          -- JSON
    attempts   INTEGER NOT NULL DEFAULT 0,
    next_try   REAL NOT NULL,
    last_error TEXT,
    dead       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(dead, next_try);
"""


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(_SCHEMA)
        self._lock = threading.Lock()

    # ---- url đã thấy ----
    def add_new_urls(self, items: list[tuple[str, str]], source: str | None) -> list[str]:
        """items = [(key, url)]. Ghi lại và trả về những url CHƯA từng thấy."""
        new: list[str] = []
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN")
            for key, url in items:
                cur = self._db.execute(
                    "INSERT OR IGNORE INTO seen_urls(key, url, source, created) VALUES (?,?,?,?)",
                    (key, url, source, now),
                )
                if cur.rowcount:
                    new.append(url)
            self._db.execute("COMMIT")
        return new

    def mark_page(self, key: str, url: str, fmt: str) -> bool:
        """True nếu trang này lần đầu được ghi nhận."""
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO pages(key, url, format, created) VALUES (?,?,?,?)",
                (key, url, fmt, time.time()),
            )
            # trang đã tải về thì url của nó cũng coi như đã thấy
            self._db.execute(
                "INSERT OR IGNORE INTO seen_urls(key, url, source, created) VALUES (?,?,?,?)",
                (key, url, "page", time.time()),
            )
            return bool(cur.rowcount)

    # ---- hàng đợi gửi đi ----
    def enqueue(self, target: str, payload: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO outbox(target, payload, next_try) VALUES (?,?,?)",
                (target, json.dumps(payload, ensure_ascii=False), time.time()),
            )

    def due(self, limit: int = 50) -> list[tuple[int, str, dict, int]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, target, payload, attempts FROM outbox "
                "WHERE dead=0 AND next_try<=? ORDER BY id LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [(i, t, json.loads(p), a) for i, t, p, a in rows]

    def done(self, item_id: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM outbox WHERE id=?", (item_id,))

    def retry_later(self, item_id: int, attempts: int, error: str, max_attempts: int) -> None:
        delay = min(300, 2 ** attempts)  # 2s, 4s, 8s ... tối đa 5 phút
        with self._lock:
            self._db.execute(
                "UPDATE outbox SET attempts=?, next_try=?, last_error=?, dead=? WHERE id=?",
                (attempts, time.time() + delay, error[:500], int(attempts >= max_attempts), item_id),
            )

    def give_up(self, item_id: int, error: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE outbox SET dead=1, last_error=? WHERE id=?", (error[:500], item_id)
            )

    def requeue_dead(self) -> int:
        with self._lock:
            cur = self._db.execute(
                "UPDATE outbox SET dead=0, attempts=0, next_try=? WHERE dead=1", (time.time(),)
            )
            return cur.rowcount

    def stats(self) -> dict:
        with self._lock:
            q = lambda sql: self._db.execute(sql).fetchone()[0]  # noqa: E731
            return {
                "seen_urls": q("SELECT COUNT(*) FROM seen_urls"),
                "pages": q("SELECT COUNT(*) FROM pages"),
                "outbox_pending": q("SELECT COUNT(*) FROM outbox WHERE dead=0"),
                "outbox_failed": q("SELECT COUNT(*) FROM outbox WHERE dead=1"),
            }

    def failed(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, target, attempts, last_error FROM outbox WHERE dead=1 ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(id=i, target=t, attempts=a, error=e) for i, t, a, e in rows]
