import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from groq import APIError, RateLimitError

from app.api import chat, identify, kb_debug

app = FastAPI(title="Pastaio Backend", version="0.1.0")

app.include_router(identify.router)
app.include_router(chat.router)
app.include_router(kb_debug.router)

# Requests per minute per client IP. The public demo shares one Groq free-tier
# key, so this keeps one visitor from using up its per-minute token budget.
RATE_LIMITS = {"/chat": 10, "/identify": 5}
_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


# Groq failures as clean JSON. Unhandled errors would become a bare 500 without
# CORS headers, which the browser reports as "can't reach the server".
@app.exception_handler(APIError)
async def groq_error(request: Request, exc: APIError):
    if isinstance(exc, RateLimitError):
        return JSONResponse({"detail": "The demo has used up its free AI quota for now. Try again later."}, status_code=503)
    return JSONResponse({"detail": "The AI service had a problem. Try again."}, status_code=502)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    # ponytail: in-memory per instance (a soft cap on Vercel, where several
    # instances can run), X-Forwarded-For is spoofable. Groq's own limit is
    # the hard cap; move to a shared store (e.g. Upstash) if abuse shows up.
    limit = RATE_LIMITS.get(request.url.path)
    if limit and request.method == "POST":
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        hits = _hits[(ip or request.client.host, request.url.path)]
        now = time.monotonic()
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= limit:
            return JSONResponse({"detail": "Too many requests, try again in a minute."}, status_code=429)
        hits.append(now)
    return await call_next(request)


# Added after rate_limit so it wraps it and 429s also carry CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("PASTAIO_CORS_ORIGINS", "http://localhost:8081").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

@app.get("/ping")
async def ping():
    print("[ping] hit")
    return {"ok": True}
