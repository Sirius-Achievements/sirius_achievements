FROM node:20.19-slim AS frontend-build

ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11.15-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    fonts-dejavu-core \
    libpq-dev \
    tzdata \
    gosu \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Moscow

COPY requirements.txt .

RUN pip install --upgrade pip
RUN pip install --default-timeout=1000 --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend-build /static/spa /app/static/spa

ENV HOME=/home/appuser

RUN addgroup --system appgroup \
    && adduser --system --ingroup appgroup --home /home/appuser appuser \
    && mkdir -p /app/static/uploads/achievements \
                /app/static/uploads/avatars \
                /app/static/uploads/support \
    && chown -R appuser:appgroup /app /home/appuser \
    && chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
