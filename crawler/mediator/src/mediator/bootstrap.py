"""The composition root: builds the adapters the service needs."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from mediator.application.controller.ports import Clock, Downloader, UrlQueue
from mediator.domain.controller.models import ControllerConfig
from mediator.domain.shared.errors import ConfigError
from mediator.infrastructure.controller.config_file import load_controller_config
from mediator.infrastructure.controller.http_downloader import HttpDownloader
from mediator.infrastructure.controller.sqlite_queue import SqliteUrlQueue


def controller_config(path: Path) -> ControllerConfig:
    return load_controller_config(path)


def url_queue(path: Path) -> UrlQueue:
    """The SQLite queue at ``database``; a path the service cannot write is a ``ConfigError``."""
    try:
        return SqliteUrlQueue(path)
    except (OSError, sqlite3.Error) as exc:
        msg = f"database: cannot open {path}: {exc}"
        raise ConfigError(msg) from exc


def downloader(config: ControllerConfig) -> Downloader:
    return HttpDownloader(
        ping_timeout=config.ping_timeout_seconds, load_timeout=config.load_timeout_seconds
    )


class _SystemClock:
    def now(self) -> float:
        return time.time()


def system_clock() -> Clock:
    return _SystemClock()
