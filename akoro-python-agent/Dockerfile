# Lightweight internal service; no database credentials or browser traffic.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --upgrade pip && pip install .

RUN useradd --create-home --uid 10001 agent
USER agent
EXPOSE 8000

# Railway/Render inject PORT. Bind 0.0.0.0 so the deployment proxy can reach it.
CMD ["sh", "-c", "uvicorn agent.service.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
