# X4G — image published once and deployed to each user's Railway account by the
# Windows app's «کانفیگ آیپی ثابت» feature. Pure-Python FastAPI server; Railway's
# edge provides the TLS/443 the generated vless:// links assume.
FROM python:3.12-slim

WORKDIR /app

# tzdata is NOT in requirements.txt but main.py does ZoneInfo("Asia/Tehran") at import
# time, which raises ZoneInfoNotFoundError on a slim image without the system tz db.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt tzdata

COPY . .

# Persisted on a Railway volume mounted here (see the deployer). Keeps configs/users
# across restarts. Railway injects PORT.
ENV DATA_DIR=/data

# IMPORTANT: run via uvicorn, NOT `python main.py`. main.py and relay_vless.py have a
# circular import that only resolves when `main` is imported as a module (uvicorn) — under
# `python main.py` the module is `__main__`, so `import main` re-executes it and fails with
# "cannot import name 'RELAY_BUF' ... circular import". Shell form so ${PORT} expands.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
