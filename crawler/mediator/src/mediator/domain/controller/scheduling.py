from __future__ import annotations

from collections.abc import Mapping

from mediator.domain.controller.models import ControllerConfig, QueuedUrl, UrlKind

DAY_SECONDS = 86400.0


def after_success(now: float, kind: UrlKind, recrawl_days: Mapping[UrlKind, float]) -> float | None:
    """When a URL sent now is due again; ``None`` when its kind is never recrawled."""
    days = recrawl_days[kind]
    return now + days * DAY_SECONDS if days > 0 else None


def after_failure(
    item: QueuedUrl, now: float, config: ControllerConfig
) -> tuple[float | None, int]:
    """``(next_due_at, attempts)`` after a failed send.

    Due again now; at ``max_attempts`` one period later (a day when the kind is never recrawled).
    """
    attempts = item.attempts + 1
    if attempts < config.max_attempts:
        return now, attempts
    return after_rejection(now, item.kind, config.recrawl_days), 0


def after_rejection(now: float, kind: UrlKind, recrawl_days: Mapping[UrlKind, float]) -> float:
    """When a URL the node refused (4xx) is due again: one period later, or a day."""
    later = after_success(now, kind, recrawl_days)
    return later if later is not None else now + DAY_SECONDS
