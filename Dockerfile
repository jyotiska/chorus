# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.9.8 AS uv
FROM docker:28-cli AS docker-cli

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates git python3 && rm -rf /var/lib/apt/lists/*

FROM base AS workspace
COPY chorus/runtime/runner.py /opt/chorus/runner.py
ENV HOME=/tmp TERM=xterm-256color NPM_CONFIG_REGISTRY=http://127.0.0.1:4873 \
    NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false
WORKDIR /workspace
USER 1000:1000
ENTRYPOINT ["python3", "/opt/chorus/runner.py", "idle"]

FROM base AS python-deps
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --python /usr/bin/python3

FROM base AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM base AS controller
WORKDIR /app
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=python-deps /app/.venv /app/.venv
COPY chorus/runtime/ chorus/runtime/
CMD [".venv/bin/python", "-m", "chorus.runtime.controller"]

FROM base AS app
WORKDIR /app
COPY --from=python-deps /app/.venv /app/.venv
COPY --from=web-build --chown=node:node /app/web /app/web
COPY chorus/ chorus/
RUN mkdir /data && chown node:node /data
USER node
ENV CHORUS_DB=/data/sessions.sqlite3 CHORUS_EXPERIMENT_ROOT=/data/experiments \
    NEXT_TELEMETRY_DISABLED=1 PYTHON_DOTENV_DISABLED=1
CMD [".venv/bin/python", "-m", "chorus.cli.container"]
