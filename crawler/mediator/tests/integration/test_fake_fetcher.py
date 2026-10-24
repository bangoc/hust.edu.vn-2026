from __future__ import annotations

import asyncio

from aiohttp.test_utils import TestClient, TestServer
from demo.fake_fetcher import create_app


def test_fake_fetcher_speaks_the_slide_protocol() -> None:
    async def scenario() -> list[object]:
        async with TestClient(TestServer(create_app(busy_seconds=0.2))) as client:
            answers: list[object] = [await (await client.get("/ping")).json()]
            load = await client.post("/load", json={"url": "https://hust.edu.vn/"})
            answers += [load.status, await load.json()]
            answers.append(await (await client.get("/ping")).json())
            second = await client.post("/load", json={"url": "https://hust.edu.vn/a"})
            answers.append(second.status)
            await asyncio.sleep(0.3)
            answers.append(await (await client.get("/ping")).json())
            return answers

    assert asyncio.run(scenario()) == [
        {"status": "đang chờ"},
        202,
        {"status": "đã nhận"},
        {"status": "đang bận"},
        409,
        {"status": "đang chờ"},
    ]
