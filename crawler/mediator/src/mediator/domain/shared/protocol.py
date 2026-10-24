"""The status strings of the slide's ``/ping`` and ``/load``."""

from __future__ import annotations

IDLE = "đang chờ"  # slide: GET /ping -> {"status": "đang chờ"}
BUSY = "đang bận"  # our convention: a node at work
ACCEPTED = "đã nhận"  # our convention: the reply of a node that took a /load
