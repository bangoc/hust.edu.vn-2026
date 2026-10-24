from __future__ import annotations

from pathlib import Path

import pytest

from mediator.domain.shared.errors import ConfigError
from mediator.infrastructure.controller.config_file import load_controller_config


def test_config_reads_repo_file() -> None:
    config = load_controller_config(Path("config/controller.yaml"))
    assert config.port == 5200
    assert config.downloaders == ("http://10.177.29.215:8800",)
    assert config.database == Path("/state/controller.sqlite3")
    assert dict(config.recrawl_days) == {"hub": 1, "page": 7, "document": 30}


def test_config_rejects_missing_downloaders(tmp_path: Path) -> None:
    path = tmp_path / "c.yaml"
    path.write_text("port: 5200\ndatabase: q.sqlite3\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="downloaders"):
        load_controller_config(path)


def test_config_rejects_unknown_kind(tmp_path: Path) -> None:
    path = tmp_path / "c.yaml"
    path.write_text(
        "downloaders: [http://a:8800]\ndatabase: q.sqlite3\nrecrawl_days: {news: 1}\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="recrawl_days"):
        load_controller_config(path)


def test_config_rejects_negative_delay(tmp_path: Path) -> None:
    path = tmp_path / "c.yaml"
    path.write_text(
        "downloaders: [http://a:8800]\ndatabase: q.sqlite3\nhost_delay_seconds: -1\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="host_delay_seconds"):
        load_controller_config(path)


def test_config_rejects_downloader_without_scheme(tmp_path: Path) -> None:
    path = tmp_path / "c.yaml"
    path.write_text("downloaders: ['10.0.0.11:8800']\ndatabase: q.sqlite3\n", encoding="utf-8")
    with pytest.raises(ConfigError, match=r"10\.0\.0\.11:8800"):
        load_controller_config(path)
