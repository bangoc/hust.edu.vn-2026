"""A stand-in Tải về node for demos: answers /ping and /load like the slide, logs each URL."""

from __future__ import annotations

import argparse
import asyncio
import logging

from aiohttp import web

from mediator.domain.shared.protocol import ACCEPTED, BUSY, IDLE

log = logging.getLogger("fake-fetcher")


def create_app(busy_seconds: float = 0.5) -> web.Application:
    state = {"busy": False}
    tasks: set[asyncio.Task[None]] = set()

    async def release() -> None:
        await asyncio.sleep(busy_seconds)
        state["busy"] = False

    async def ping(_: web.Request) -> web.Response:
        return web.json_response({"status": BUSY if state["busy"] else IDLE})

    async def load(request: web.Request) -> web.Response:
        body = await request.json()
        if state["busy"]:
            return web.json_response({"status": BUSY}, status=409)
        state["busy"] = True
        log.info("load %s", body.get("url"))
        task = asyncio.create_task(release())
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return web.json_response({"status": ACCEPTED}, status=202)

    app = web.Application()
    app.router.add_get("/ping", ping)
    app.router.add_post("/load", load)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8800)
    parser.add_argument("--busy-seconds", type=float, default=0.5)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    web.run_app(create_app(args.busy_seconds), port=args.port, print=None)


if __name__ == "__main__":
    main()
