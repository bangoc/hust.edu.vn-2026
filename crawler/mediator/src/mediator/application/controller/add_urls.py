from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from mediator.application.controller.ports import Clock, UrlQueue
from mediator.domain.controller.kinds import url_kind
from mediator.domain.controller.models import UrlKind
from mediator.domain.shared.url import canonicalize_url


@dataclass(frozen=True, slots=True)
class AddResult:
    accepted: int
    duplicates: int
    rejected: int


def add_urls(queue: UrlQueue, urls: Sequence[str], clock: Clock) -> AddResult:
    """Queue the URLs of one ``POST /add``; a known URL keeps its schedule.

    Every URL is accepted whatever its host: filtering by scope is the aggregator's job.
    """
    items: dict[str, tuple[str, str, UrlKind]] = {}
    rejected = 0
    for raw in urls:
        canonical = canonicalize_url(raw)
        if canonical is None:
            rejected += 1
            continue
        url, host = canonical
        items.setdefault(url, (url, host, url_kind(url)))
    accepted = queue.add(list(items.values()), clock.now())
    return AddResult(accepted, len(urls) - rejected - accepted, rejected)
