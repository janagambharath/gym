## ── Stage 1: Build PWA ──────────────────────────────────────────────
FROM node:20-slim AS pwa-builder
WORKDIR /pwa
COPY renewal-desk-pwa/package.json renewal-desk-pwa/package-lock.json ./
RUN npm ci
COPY renewal-desk-pwa/ .
RUN npm run build

## ── Stage 2: Python app ─────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev postgresql-client curl bash \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy built PWA from stage 1
COPY --from=pwa-builder /pwa/dist /app/renewal-desk-pwa/dist

RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/health || exit 1

CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:create_app()"]

