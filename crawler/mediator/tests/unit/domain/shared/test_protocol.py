from __future__ import annotations

from mediator.domain.shared.protocol import ACCEPTED, BUSY, IDLE


def test_slide_status_strings() -> None:
    assert (IDLE, BUSY, ACCEPTED) == ("đang chờ", "đang bận", "đã nhận")
