# mediator (Điều khiển, khối 3 trên slide): `mediator serve` trên cổng 5200.
FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
COPY config ./config

RUN useradd --create-home --uid 1000 app && mkdir -p /state && chown app /state
USER app

ENTRYPOINT ["mediator"]
CMD ["serve", "--config", "config/controller.yaml"]
