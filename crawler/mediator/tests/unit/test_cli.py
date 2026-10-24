from __future__ import annotations

from pathlib import Path

import pytest
from aiohttp import web

from mediator import cli
from mediator.api import common


def _config(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "controller.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def test_serve_runs_add_on_the_configured_port(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    served: list[tuple[web.Application, int]] = []

    def fake_run(app: web.Application, port: int) -> None:
        served.append((app, port))

    monkeypatch.setattr(common, "run", fake_run)
    config = _config(
        tmp_path, f"port: 5201\ndownloaders: [http://n:8800]\ndatabase: {tmp_path / 'q.sqlite3'}\n"
    )
    assert cli.main(["serve", "--config", str(config)]) == 0
    ((app, port),) = served
    assert port == 5201
    assert [
        r.method for r in app.router.routes() if r.resource and r.resource.canonical == "/add"
    ] == ["POST"]


def test_bad_config_exits_2_with_the_reason(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["serve", "--config", str(_config(tmp_path, "port: 5200\n"))]) == 2
    assert "downloaders" in capsys.readouterr().err


def test_unwritable_database_exits_2_with_the_reason(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("", encoding="utf-8")
    config = _config(tmp_path, f"downloaders: [http://n:8800]\ndatabase: {blocker / 'q.sqlite3'}\n")
    assert cli.main(["serve", "--config", str(config)]) == 2
    assert "database" in capsys.readouterr().err
