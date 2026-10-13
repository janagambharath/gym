FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Graceful shutdown: Docker sends SIGTERM, connector catches it
STOPSIGNAL SIGTERM

CMD ["python", "main.py"]
