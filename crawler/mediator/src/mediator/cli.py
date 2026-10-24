"""``mediator serve``: run the Điều khiển service of the slide."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from mediator import bootstrap
from mediator.api import common, server
from mediator.domain.shared.errors import ConfigError


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mediator", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="POST /add on the configured port")
    serve.add_argument("--config", type=Path, default=Path("config/controller.yaml"))
    args = parser.parse_args(argv)
    try:
        config = bootstrap.controller_config(args.config)
        queue = bootstrap.url_queue(config.database)
    except ConfigError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    app = server.create_service(
        queue, bootstrap.downloader(config), bootstrap.system_clock(), config
    )
    common.run(app, config.port)
    return 0


def run() -> None:
    sys.exit(main())
