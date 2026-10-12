FROM ghcr.io/astral-sh/uv:0.9.18 AS uv
FROM python:3.13.11-slim-bookworm AS runtime

ENV PATH=/workspace/agent/.venv/bin:$PATH
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY --from=uv /uv /uvx /bin/

WORKDIR /workspace/agent

COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY agent/src ./src
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uvicorn", "onholidai_agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]