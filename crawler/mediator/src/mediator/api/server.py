"""Điều khiển (block 3, port 5200): ``POST /add`` plus the loop that feeds the download nodes."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from aiohttp import web

from mediator.api.common import error, json_object
from mediator.application.controller.add_urls import add_urls
from mediator.application.controller.dispatch import Dispatcher
from mediator.application.controller.ports import Clock, Downloader, UrlQueue
from mediator.domain.controller.models import ControllerConfig

log = logging.getLogger(__name__)

SUMMARY_SECONDS = 30.0


def create_app(queue: UrlQueue, clock: Clock) -> web.Application:
    async def add(request: web.Request) -> web.Response:
        body = await json_object(request)
        urls = body.get("urls")
        if not isinstance(urls, list) or not all(isinstance(url, str) for url in urls):
            return error(400, "urls must be a list of strings")
        result = add_urls(queue, urls, clock)
        return web.json_response(
            {
                "accepted": result.accepted,
                "duplicates": result.duplicates,
                "rejected": result.rejected,
            }
        )

    app = web.Application(client_max_size=16 * 1024 * 1024)
    app.router.add_post("/add", add)
    return app


def create_service(
    queue: UrlQueue, downloader: Downloader, clock: Clock, config: ControllerConfig
) -> web.Application:
    """``create_app`` with the dispatch and summary loops running for the app's lifetime."""
    app = create_app(queue, clock)
    dispatcher = Dispatcher(queue, downloader, clock, config)

    async def background(_: web.Application) -> AsyncIterator[None]:
        tasks = [
            asyncio.create_task(dispatch_loop(dispatcher, config.tick_seconds)),
            asyncio.create_task(summary_loop(queue, dispatcher, clock)),
        ]
        yield
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await downloader.close()

    app.cleanup_ctx.append(background)
    return app


async def dispatch_loop(dispatcher: Dispatcher, tick_seconds: float) -> None:
    while True:
        try:
            sent = await dispatcher.step()
        except Exception:
            log.exception("dispatch step failed")
            sent = False
        if not sent:
            await asyncio.sleep(tick_seconds)


async def summary_loop(
    queue: UrlQueue, dispatcher: Dispatcher, clock: Clock, every: float = SUMMARY_SECONDS
) -> None:
    while True:
        await asyncio.sleep(every)
        now = clock.now()
        counts = queue.counts(now)
        nodes = len(dispatcher.config.downloaders)
        resting = nodes - len(dispatcher.rotation.order(now))
        log.info(
            "controller: %d urls, %d due, %d/%d nodes resting",
            counts.total,
            counts.due,
            resting,
            nodes,
        )
