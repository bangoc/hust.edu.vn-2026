from __future__ import annotations

import asyncio
import itertools
import time
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mediator.api.server import create_service
from mediator.domain.controller.models import ControllerConfig
from mediator.domain.shared.protocol import ACCEPTED, BUSY, IDLE
from mediator.infrastructure.controller.http_downloader import HttpDownloader
from mediator.infrastructure.controller.sqlite_queue import SqliteUrlQueue


class _Clock:
    def now(self) -> float:
        return time.time()


def _node(name: str, received: list[tuple[str, str, float]]) -> web.Application:
    async def ping(_: web.Request) -> web.Response:
        return web.json_response({"status": IDLE})

    async def load(request: web.Request) -> web.Response:
        received.append((name, (await request.json())["url"], time.monotonic()))
        return web.json_response({"status": ACCEPTED}, status=202)

    app = web.Application()
    app.router.add_get("/ping", ping)
    app.router.add_post("/load", load)
    return app


def test_service_sends_added_urls_to_fake_nodes(tmp_path: Path) -> None:
    received: list[tuple[str, str, float]] = []
    urls = [
        "https://a.hust.edu.vn/1",
        "https://a.hust.edu.vn/2",
        "https://b.hust.edu.vn/1",
        "https://b.hust.edu.vn/2",
    ]

    async def scenario() -> None:
        async with (
            TestServer(_node("a", received)) as node_a,
            TestServer(_node("b", received)) as node_b,
        ):
            config = ControllerConfig(
                downloaders=(
                    str(node_a.make_url("")).rstrip("/"),
                    str(node_b.make_url("")).rstrip("/"),
                ),
                database=tmp_path / "q.sqlite3",
                tick_seconds=0.05,
                host_delay_seconds=0.1,
            )
            queue = SqliteUrlQueue(config.database)
            downloader = HttpDownloader(ping_timeout=2.0, load_timeout=2.0)
            app = create_service(queue, downloader, _Clock(), config)
            async with TestClient(TestServer(app)) as client:
                response = await client.post("/add", json={"urls": urls})
                assert await response.json() == {"accepted": 4, "duplicates": 0, "rejected": 0}
                for _ in range(60):
                    if len(received) == len(urls):
                        break
                    await asyncio.sleep(0.05)

    asyncio.run(scenario())
    assert sorted(url for _, url, _ in received) == urls
    nodes = [node for node, _, _ in received]
    assert all(first != second for first, second in itertools.pairwise(nodes))
    for host in ("a.hust", "b.hust"):
        times = [at for _, url, at in received if host in url]
        assert times[1] - times[0] >= 0.1 - 0.02


def test_slow_load_counts_as_failed(tmp_path: Path) -> None:
    async def ping(_: web.Request) -> web.Response:
        return web.json_response({"status": IDLE})

    async def slow_load(_: web.Request) -> web.Response:
        await asyncio.sleep(1.0)
        return web.json_response({"status": ACCEPTED}, status=202)

    node = web.Application()
    node.router.add_get("/ping", ping)
    node.router.add_post("/load", slow_load)

    async def scenario() -> str:
        async with TestServer(node) as server:
            downloader = HttpDownloader(ping_timeout=2.0, load_timeout=0.2)
            try:
                return await downloader.load(str(server.make_url("")).rstrip("/"), "https://h/a")
            finally:
                await downloader.close()

    assert asyncio.run(scenario()) == "failed"


def test_http_downloader_maps_409_to_busy() -> None:
    async def load(request: web.Request) -> web.Response:
        return web.json_response({"status": BUSY}, status=409)

    app = web.Application()
    app.router.add_post("/load", load)

    async def scenario() -> str:
        async with TestServer(app) as node:
            downloader = HttpDownloader(ping_timeout=2.0, load_timeout=2.0)
            try:
                return await downloader.load(str(node.make_url("")).rstrip("/"), "https://a/")
            finally:
                await downloader.close()

    assert asyncio.run(scenario()) == "busy"
