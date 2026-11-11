FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Runtime deps only (pyproject also lists ollama, which the hosted demo doesn't
# use). Installed before copying app code so this layer stays cached.
RUN pip install \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.30" \
    "pydantic>=2.9" \
    "python-multipart>=0.0.9" \
    "groq>=0.11"

# Hugging Face Spaces runs containers as uid 1000.
RUN useradd -m -u 1000 user
USER user
WORKDIR /home/user/app
COPY --chown=user app/ ./app/

# Public demo defaults. GROQ_API_KEY comes from the Space secret, never the image.
ENV PORT=7860 \
    PASTAIO_REASONING_BACKEND=groq \
    PASTAIO_VISION_BACKEND=groq \
    PASTAIO_CORS_ORIGINS=https://leventestaub.github.io
EXPOSE 7860

HEALTHCHECK CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://localhost:{os.environ[\"PORT\"]}/health')"

CMD exec uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
