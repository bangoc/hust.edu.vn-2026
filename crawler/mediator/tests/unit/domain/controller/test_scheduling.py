from __future__ import annotations

from pathlib import Path

from mediator.domain.controller.models import ControllerConfig, QueuedUrl, UrlKind
from mediator.domain.controller.scheduling import after_failure, after_rejection, after_success

DAY = 86400.0
PERIODS: dict[UrlKind, float] = {"hub": 1.0, "page": 7.0, "document": 30.0}


def _config(**overrides: object) -> ControllerConfig:
    return ControllerConfig(downloaders=("http://a",), database=Path("q.sqlite3"), **overrides)  # type: ignore[arg-type]


def _item(attempts: int) -> QueuedUrl:
    return QueuedUrl("https://x/a", "x", "page", 0.0, None, attempts)


def test_default_config_matches_spec() -> None:
    config = _config()
    assert (config.port, config.host_delay_seconds, config.max_attempts) == (5200, 1.0, 5)
    assert dict(config.recrawl_days) == PERIODS


def test_after_success_uses_kind_period() -> None:
    assert after_success(1000.0, "page", PERIODS) == 1000.0 + 7 * DAY


def test_after_success_zero_period_disables() -> None:
    assert after_success(0.0, "hub", {**PERIODS, "hub": 0.0}) is None


def test_after_failure_keeps_due_until_max_attempts() -> None:
    assert after_failure(_item(2), 50.0, _config()) == (50.0, 3)


def test_after_failure_backs_off_one_period_at_max() -> None:
    assert after_failure(_item(4), 50.0, _config()) == (50.0 + 7 * DAY, 0)


def test_after_failure_at_max_with_zero_period_waits_a_day() -> None:
    config = _config(recrawl_days={**PERIODS, "page": 0.0})
    assert after_failure(_item(4), 50.0, config) == (50.0 + DAY, 0)


def test_after_rejection_waits_one_period() -> None:
    assert after_rejection(50.0, "page", {"hub": 1, "page": 7, "document": 0}) == 50.0 + 7 * 86400.0
    assert after_rejection(50.0, "document", {"hub": 1, "page": 7, "document": 0}) == 50.0 + 86400.0
