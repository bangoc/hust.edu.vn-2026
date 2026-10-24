from __future__ import annotations

from http import HTTPStatus

import aiohttp

from mediator.application.controller.ports import LoadResult


class HttpDownloader:
    """The ``Downloader`` port over the slide's ``GET /ping`` and ``POST /load`` of a node."""

    def __init__(self, *, ping_timeout: float, load_timeout: float) -> None:
        self.ping_timeout = ping_timeout
        self.load_timeout = load_timeout
        self.session: aiohttp.ClientSession | None = None

    def _session(self) -> aiohttp.ClientSession:
        if self.session is None:
            self.session = aiohttp.ClientSession()
        return self.session

    async def ping(self, node: str) -> str | None:
        try:
            async with self._session().get(
                f"{node}/ping", timeout=aiohttp.ClientTimeout(total=self.ping_timeout)
            ) as response:
                if not response.ok:
                    return None
                body = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return None
        status = body.get("status") if isinstance(body, dict) else None
        return status if isinstance(status, str) else None

    async def load(self, node: str, url: str) -> LoadResult:
        try:
            async with self._session().post(
                f"{node}/load",
                json={"url": url},
                timeout=aiohttp.ClientTimeout(total=self.load_timeout),
            ) as response:
                if response.status == HTTPStatus.CONFLICT:
                    return "busy"
                if response.ok:
                    return "accepted"
                # 4xx: the node is fine but refuses this URL (bad/blocked url, queue_full is 503).
                return (
                    "rejected" if response.status < HTTPStatus.INTERNAL_SERVER_ERROR else "failed"
                )
        except (aiohttp.ClientError, TimeoutError):
            return "failed"

    async def close(self) -> None:
        if self.session is not None:
            await self.session.close()
            self.session = None
