from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


def connect(path: Path) -> sqlite3.Connection:
    """A WAL connection in autocommit mode: writes that belong together go in ``transaction``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    return db


@contextmanager
def transaction(db: sqlite3.Connection) -> Iterator[None]:
    """One explicit transaction: ``with db:`` alone does not begin one in autocommit mode."""
    db.execute("BEGIN")
    try:
        yield
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
