from __future__ import annotations

import logging
import time
import unicodedata

from mediator.application.controller.ports import Clock, Downloader, UrlQueue
from mediator.domain.controller.models import ControllerConfig
from mediator.domain.controller.rotation import NodeRotation
from mediator.domain.controller.scheduling import after_failure, after_rejection, after_success
from mediator.domain.shared.protocol import BUSY, IDLE

log = logging.getLogger(__name__)


class Dispatcher:
    """Sends due URLs to idle download nodes, one URL per step."""

    def __init__(
        self, queue: UrlQueue, downloader: Downloader, clock: Clock, config: ControllerConfig
    ) -> None:
        self.queue = queue
        self.downloader = downloader
        self.clock = clock
        self.config = config
        self.rotation = NodeRotation(config.downloaders)

    async def step(self) -> bool:
        """Send one due URL; ``True`` when a node accepted it."""
        now = self.clock.now()
        item = self.queue.next_due(now, self.config.host_delay_seconds)
        if item is None:
            return False
        for node in self.rotation.order(now):
            raw = await self.downloader.ping(node)
            # A node typed on another system may send "đang chờ" decomposed (NFD); same text.
            status = unicodedata.normalize("NFC", raw) if raw is not None else None
            if status is None:
                self.rotation.rest(node, now + self.config.node_cooldown_seconds)
                log.warning(
                    "downloader %s không trả lời /ping, %.0f giây nữa hỏi lại",
                    node,
                    self.config.node_cooldown_seconds,
                )
                continue
            if status != IDLE:
                if status != BUSY:
                    # A slide node answers "đang chờ" or "đang bận"; say what came instead.
                    log.warning("downloader %s trả /ping trạng thái lạ: %r", node, status)
                continue
            self.rotation.used(node)
            result = await self.downloader.load(node, item.url)
            if result == "busy":
                continue  # taken by someone else between ping and load; try the next node
            if result == "accepted":
                due = after_success(now, item.kind, self.config.recrawl_days)
                self.queue.mark_sent(item.url, now, due)
                log.info("đã gửi %s -> %s", item.url, node)
                return True
            if result == "rejected":
                # The URL's fault, not the node's: no rest, and no quick retry of the same URL.
                due = after_rejection(now, item.kind, self.config.recrawl_days)
                self.queue.mark_failed(item.url, 0, due)
                log.warning(
                    "bị từ chối %s -> %s, gửi lại lúc %s",
                    item.url,
                    node,
                    time.strftime("%Y-%m-%d %H:%M", time.localtime(due)),
                )
                return False
            self.rotation.rest(node, now + self.config.node_cooldown_seconds)
            due, attempts = after_failure(item, now, self.config)
            self.queue.mark_failed(item.url, attempts, due)
            log.warning(
                "gửi lỗi %s -> %s (lần %d), downloader nghỉ %.0f giây",
                item.url,
                node,
                item.attempts + 1,
                self.config.node_cooldown_seconds,
            )
            if attempts == 0:
                log.warning(
                    "bỏ qua %s tới %s",
                    item.url,
                    time.strftime("%Y-%m-%d %H:%M", time.localtime(due)),
                )
            return False
        return False
