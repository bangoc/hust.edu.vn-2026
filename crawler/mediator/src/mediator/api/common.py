from __future__ import annotations

import asyncio
import json
import logging
import os
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
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file := os.environ.get("MEDIATOR_LOG_FILE"):  # kept on the volume, survives rebuilds
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )
    asyncio.run(_serve(app, port))


async def _serve(app: web.Application, port: int) -> None:
    runner = web.AppRunner(app, access_log=None)  # handlers log what matters
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", port).start()  # noqa: S104 -- a service inside a container
    log.info("mediator chạy ở cổng %d", port)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        await runner.cleanup()
