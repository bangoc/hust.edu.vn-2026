from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from mediator.application.controller.ports import Clock, UrlQueue
from mediator.domain.controller.kinds import url_kind
from mediator.domain.controller.models import UrlKind
from mediator.domain.shared.url import canonicalize_url


@dataclass(frozen=True, slots=True)
class AddResult:
    accepted: int
    duplicates: int
    rejected: int
    # What became of each URL sent, in order: (url as sent, "mới" | "trùng" | "bị loại").
    outcomes: tuple[tuple[str, str], ...] = field(default=(), compare=False)


def add_urls(queue: UrlQueue, urls: Sequence[str], clock: Clock) -> AddResult:
    """Queue the URLs of one ``POST /add``; a known URL keeps its schedule.

    Every URL is accepted whatever its host: filtering by scope is the aggregator's job.
    """
    items: dict[str, tuple[str, str, UrlKind]] = {}
    canonical_of: list[str | None] = []
    for raw in urls:
        canonical = canonicalize_url(raw)
        canonical_of.append(canonical[0] if canonical else None)
        if canonical is not None:
            url, host = canonical
            items.setdefault(url, (url, host, url_kind(url)))
    fresh = set(queue.add(list(items.values()), clock.now()))
    outcomes: list[tuple[str, str]] = []
    for raw, url in zip(urls, canonical_of, strict=True):
        if url is None:
            outcomes.append((raw, "bị loại"))
        elif url in fresh:
            fresh.discard(url)  # a second spelling of it in the same request is a duplicate
            outcomes.append((raw, "mới"))
        else:
            outcomes.append((raw, "trùng"))
    counts = [outcome for _, outcome in outcomes]
    return AddResult(
        counts.count("mới"), counts.count("trùng"), counts.count("bị loại"), tuple(outcomes)
    )
