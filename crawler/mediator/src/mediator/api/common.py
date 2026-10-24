from __future__ import annotations

import asyncio
import json
import logging
import signal
from typing import Any

from aiohttp import web

log = logging.getLogger(__name__)


def error(status: int, reason: str) -> web.Response:
    return web.json_response({"error": reason}, status=status)


async def json_object(request: web.Request) -> dict[str, Any]:
    """The request body as a JSON object; anything else is a 400 with the reason."""
    try:
        body = json.loads(await request.read() or b"null")
    except (ValueError, UnicodeDecodeError) as exc:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": f"invalid JSON: {exc}"}), content_type="application/json"
        ) from exc
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "body must be a JSON object"}),
            content_type="application/json",
        )
    return body


def run(app: web.Application, port: int) -> None:
    """Serve ``app`` on every interface until SIGTERM/SIGINT."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    asyncio.run(_serve(app, port))


async def _serve(app: web.Application, port: int) -> None:
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", port).start()  # noqa: S104 -- a service inside a container
    log.info("listening on :%d", port)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        await runner.cleanup()
