# Akoro lead-scout — FastAPI lead-generation service.
# Tiny, pure-Python (httpx + fastapi), fits the smallest CPU box.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py providers.py audit.py ./

# Jobs + CSVs persist here. On Railway, attach a Volume mounted at /app/data
# so results survive restarts/redeploys (otherwise they live only in the
# container's ephemeral filesystem).
RUN mkdir -p /app/data

# Railway injects $PORT; default 8100 for local/VM runs.
ENV PORT=8100
EXPOSE 8100

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
