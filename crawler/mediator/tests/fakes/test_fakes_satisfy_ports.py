from __future__ import annotations

from mediator.application.controller import ports
from tests.fakes.controller import FakeClock, FakeDownloader, FakeUrlQueue


def test_controller_fakes_satisfy_their_ports() -> None:
    queue: ports.UrlQueue = FakeUrlQueue()
    downloader: ports.Downloader = FakeDownloader({})
    clock: ports.Clock = FakeClock(0.0)
    for instance, port in (
        (queue, ports.UrlQueue),
        (downloader, ports.Downloader),
        (clock, ports.Clock),
    ):
        missing = [n for n in port.__protocol_attrs__ if not hasattr(instance, n)]  # type: ignore[attr-defined]
        assert missing == []
