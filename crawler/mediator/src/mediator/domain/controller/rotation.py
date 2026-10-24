from __future__ import annotations

from collections.abc import Sequence


class NodeRotation:
    """Round robin over the download nodes, skipping nodes that rest after a failure."""

    def __init__(self, nodes: Sequence[str]) -> None:
        self.nodes = list(nodes)
        self.next_index = 0
        self.resting: dict[str, float] = {}

    def order(self, now: float) -> list[str]:
        """Nodes to try, starting after the last one used."""
        rotated = self.nodes[self.next_index :] + self.nodes[: self.next_index]
        return [node for node in rotated if self.resting.get(node, 0.0) <= now]

    def used(self, node: str) -> None:
        self.next_index = (self.nodes.index(node) + 1) % len(self.nodes)

    def rest(self, node: str, until: float) -> None:
        self.resting[node] = until
