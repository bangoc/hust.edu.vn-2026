"""Luồng nền: lấy các mục trong outbox và gửi sang Lưu trữ / Điều khiển, có thử lại."""
import logging
import threading

import httpx

from . import config
from .store import Store

log = logging.getLogger("merger.forwarder")


class Forwarder:
    def __init__(self, store: Store, client: httpx.Client | None = None):
        self.store = store
        self.client = client or httpx.Client(timeout=config.HTTP_TIMEOUT)
        self.targets = {
            "storage": f"{config.STORAGE_URL}/add",
            "controller": f"{config.CONTROLLER_URL}/add",
        }
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="forwarder", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)

    def kick(self) -> None:
        """Báo có việc mới để gửi ngay, không đợi chu kỳ."""
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                sent = self.flush()
            except Exception:  # không để luồng nền chết
                log.exception("forwarder loop error")
                sent = 0
            if not sent:
                self._wake.wait(timeout=2)
                self._wake.clear()

    def flush(self) -> int:
        """Gửi một lượt các mục đến hạn. Trả về số mục đã xử lý."""
        items = self.store.due()
        for item_id, target, payload, attempts in items:
            url = self.targets[target]
            try:
                resp = self.client.post(url, json=payload)
            except httpx.HTTPError as e:
                self.store.retry_later(item_id, attempts + 1, f"{type(e).__name__}: {e}", config.MAX_ATTEMPTS)
                log.warning("gửi %s thất bại (lần %d): %s", target, attempts + 1, e)
                continue
            if resp.is_success:
                self.store.done(item_id)
                log.info("đã gửi %s -> %s %s", target, resp.status_code, _brief(payload))
            elif 400 <= resp.status_code < 500 and resp.status_code not in (408, 429):
                # Dữ liệu bị bên nhận từ chối -> thử lại cũng vô ích.
                self.store.give_up(item_id, f"HTTP {resp.status_code}: {resp.text[:300]}")
                log.error("%s từ chối %s: %s %s", target, _brief(payload), resp.status_code, resp.text[:200])
            else:
                self.store.retry_later(item_id, attempts + 1, f"HTTP {resp.status_code}", config.MAX_ATTEMPTS)
                log.warning("%s trả %s, sẽ thử lại", target, resp.status_code)
        return len(items)


def _brief(payload: dict) -> str:
    if "urls" in payload:
        return f"{len(payload['urls'])} url"
    return payload.get("url", "")
