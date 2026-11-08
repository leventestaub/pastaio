FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Copy dependency manifest first so Docker can cache the install layer when
# only app code changes. The pyproject.toml is the only file that affects
# what gets installed.
COPY pyproject.toml ./

# Install only the runtime dependencies, not the project itself yet.
# `pip install .` would try to install pastaio-backend as a package, which
# requires the app/ directory to exist — but we want to install deps BEFORE
# copying app code so the deps layer is cached across code changes.
#
# Workaround: install dependencies directly from pyproject.toml using a
# small bootstrap script. The `--editable .` flag would also work but
# editable installs add unnecessary overhead at runtime.
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.30" \
    "pydantic>=2.9" \
    "python-multipart>=0.0.9" \
    "groq>=0.11"

# Copy app code last so changes here don't bust the dependency cache layer.
COPY app/ ./app/

# Cloud Run sets PORT=8080 at runtime. Default for local docker run.
ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1