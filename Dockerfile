FROM node:24-bookworm-slim AS web-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build

FROM python:3.12-slim-bookworm AS api-build
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/api/.venv/bin:$PATH" WEB_DIST_DIR=/app/web APP_ENV=production
WORKDIR /app/api
RUN groupadd --gid 10001 voting && useradd --uid 10001 --gid voting --no-create-home voting
COPY --from=api-build /app/api/.venv ./.venv
COPY apps/api/app ./app
COPY apps/api/migrations ./migrations
COPY apps/api/alembic.ini ./alembic.ini
COPY --from=web-build /build/apps/web/dist /app/web
USER voting
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log"]
