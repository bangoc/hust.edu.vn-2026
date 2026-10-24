from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

import yaml

from mediator.domain.controller.models import DEFAULT_RECRAWL_DAYS, ControllerConfig, UrlKind
from mediator.domain.shared.errors import ConfigError

_NUMBERS = (
    "host_delay_seconds",
    "ping_timeout_seconds",
    "load_timeout_seconds",
    "node_cooldown_seconds",
    "tick_seconds",
)


def load_controller_config(path: Path) -> ControllerConfig:
    """Read ``controller.yaml``; a missing or unusable value is a ``ConfigError`` naming it."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        msg = f"cannot read {path}: {exc}"
        raise ConfigError(msg) from exc
    if not isinstance(raw, dict):
        msg = f"{path} must hold a mapping"
        raise ConfigError(msg)
    values = cast("dict[str, Any]", raw)
    downloaders = values.get("downloaders")
    if not isinstance(downloaders, list) or not downloaders:
        msg = "downloaders must list at least one download node URL"
        raise ConfigError(msg)
    nodes = tuple(str(node).rstrip("/") for node in cast("list[object]", downloaders))
    for node in nodes:
        if not node.startswith(("http://", "https://")):
            msg = f"downloaders: {node} must be a URL such as http://10.0.0.11:8800"
            raise ConfigError(msg)
    if "database" not in values:
        msg = "database is required"
        raise ConfigError(msg)
    numbers: dict[str, float] = {}
    for name in _NUMBERS:
        if name in values:
            numbers[name] = _non_negative(name, values[name])
    return ControllerConfig(
        downloaders=nodes,
        database=Path(str(values["database"])),
        port=int(_non_negative("port", values.get("port", 5200))),
        max_attempts=max(1, int(_non_negative("max_attempts", values.get("max_attempts", 5)))),
        recrawl_days=_recrawl_days(values.get("recrawl_days", DEFAULT_RECRAWL_DAYS)),
        **numbers,
    )


def _non_negative(name: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        msg = f"{name} must be a non-negative number"
        raise ConfigError(msg)
    return float(value)


def _recrawl_days(value: object) -> dict[UrlKind, float]:
    if not isinstance(value, Mapping):
        msg = "recrawl_days must map hub/page/document to days"
        raise ConfigError(msg)
    given = cast("Mapping[str, object]", value)
    unknown = set(given) - set(DEFAULT_RECRAWL_DAYS)
    if unknown:
        msg = f"recrawl_days has unknown kinds: {sorted(unknown)}"
        raise ConfigError(msg)
    days = dict(DEFAULT_RECRAWL_DAYS)
    for kind, raw_days in given.items():
        days[cast("UrlKind", kind)] = _non_negative(f"recrawl_days.{kind}", raw_days)
    return days
