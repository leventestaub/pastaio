"""Vercel entrypoint for the public demo: demo defaults, then the normal app.

GROQ_API_KEY comes from the Vercel project's environment variables.
Anything set there also overrides these defaults.
"""
import os

for key, value in {
    "PASTAIO_REASONING_BACKEND": "groq",
    "PASTAIO_VISION_BACKEND": "groq",
    "PASTAIO_CORS_ORIGINS": "https://leventestaub.github.io",
    "PASTAIO_DEV_LOG": "0",  # don't log visitors' messages
}.items():
    os.environ.setdefault(key, value)

from app.main import app  # noqa: E402,F401
