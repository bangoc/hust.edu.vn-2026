from __future__ import annotations

import asyncio

import pytest
from aiohttp.test_utils import TestClient, TestServer

from mediator.api.server import create_app
from tests.fakes.controller import FakeClock, FakeUrlQueue


def _post(queue: FakeUrlQueue, body: str) -> tuple[int, object]:
    async def scenario() -> tuple[int, object]:
        async with TestClient(TestServer(create_app(queue, FakeClock(0.0)))) as client:
            response = await client.post("/add", data=body)
            return response.status, await response.json()

    return asyncio.run(scenario())


def test_add_returns_counts() -> None:
    queue = FakeUrlQueue()
    assert _post(queue, '{"urls": ["https://hust.edu.vn/a", "x"]}') == (
        200,
        {"accepted": 1, "duplicates": 0, "rejected": 1},
    )
    assert list(queue.rows) == ["https://hust.edu.vn/a"]


def test_add_empty_list_is_ok() -> None:
    assert _post(FakeUrlQueue(), '{"urls": []}') == (
        200,
        {"accepted": 0, "duplicates": 0, "rejected": 0},
    )


@pytest.mark.parametrize("body", ['{"urls": "a"}', '{"urls": [1]}', "{}", "not json"])
def test_add_bad_body_is_400(body: str) -> None:
    queue = FakeUrlQueue()
    status, answer = _post(queue, body)
    assert status == 400
    assert isinstance(answer, dict) and "error" in answer
    assert queue.rows == {}
