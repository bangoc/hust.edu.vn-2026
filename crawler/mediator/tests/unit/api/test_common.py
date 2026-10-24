from __future__ import annotations

import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mediator.api.common import error, json_object


def _app() -> web.Application:
    async def handle(request: web.Request) -> web.Response:
        body = await json_object(request)
        return web.json_response({"keys": sorted(body)})

    app = web.Application()
    app.router.add_post("/add", handle)
    return app


def _post(body: str) -> tuple[int, object]:
    async def scenario() -> tuple[int, object]:
        async with TestClient(TestServer(_app())) as client:
            response = await client.post("/add", data=body)
            return response.status, await response.json()

    return asyncio.run(scenario())


def test_json_object_returns_object() -> None:
    assert _post('{"b": 1, "a": 2}') == (200, {"keys": ["a", "b"]})


def test_json_object_rejects_non_object() -> None:
    status, body = _post("[]")
    assert status == 400
    assert isinstance(body, dict) and "error" in body


def test_json_object_rejects_invalid_json() -> None:
    assert _post("not json")[0] == 400


def test_error_response() -> None:
    response = error(503, "mongo unavailable")
    assert response.status == 503
    assert response.text == '{"error": "mongo unavailable"}'
