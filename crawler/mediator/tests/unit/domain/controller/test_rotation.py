from __future__ import annotations

from mediator.domain.controller.rotation import NodeRotation


def test_rotation_starts_after_last_used_and_skips_resting() -> None:
    rotation = NodeRotation(["a", "b", "c"])
    rotation.used("a")
    rotation.rest("b", until=50.0)
    assert rotation.order(now=10.0) == ["c", "a"]
    assert rotation.order(now=60.0) == ["b", "c", "a"]


def test_rotation_starts_at_first_node() -> None:
    assert NodeRotation(["a", "b"]).order(now=0.0) == ["a", "b"]
