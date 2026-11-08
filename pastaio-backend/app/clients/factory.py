"""Dependency wiring.

Single place that decides which client implementation is used. Driven by env
vars so dev/CI/prod can swap without code changes:

  PASTAIO_REASONING_BACKEND  = "stub" | "ollama" | "groq"  (default: "stub")
  PASTAIO_VISION_BACKEND     = "stub" | "ollama" | "groq"  (default: "stub")

Ollama config (when PASTAIO_*_BACKEND=ollama):
  PASTAIO_OLLAMA_HOST        = "http://localhost:11434"  (default)
  PASTAIO_OLLAMA_LLM_MODEL   = "qwen3.5:4b"   (default; reasoning)
  PASTAIO_OLLAMA_VLM_MODEL   = "qwen3-vl:4b"  (default; vision)

Groq config (when PASTAIO_*_BACKEND=groq):
  GROQ_API_KEY               = "gsk_..."  (required)
  PASTAIO_GROQ_LLM_MODEL     = "qwen/qwen3-32b"
  PASTAIO_GROQ_VLM_MODEL     = "meta-llama/llama-4-scout-17b-16e-instruct"

Logging:
  PASTAIO_LOG_LEVEL          = "normal" | "verbose"  (default: "normal")
  PASTAIO_DEV_LOG            = "1" to enable, "0" to disable (default: "1")
                               When enabled, all client calls log to stdout.

Stub remains the default so tests and any cold-start without a backend
configured still work.
"""
import os
from functools import lru_cache

from app.clients.base import ReasoningClient, VisionClient
from app.clients.stubs import StubReasoningClient, StubVisionClient
from app.services.dev_log import wrap_reasoning_client, wrap_vision_client


def _dev_log_enabled() -> bool:
    return os.getenv("PASTAIO_DEV_LOG", "1") != "0"


@lru_cache
def get_vision_client() -> VisionClient:
    backend = os.getenv("PASTAIO_VISION_BACKEND", "stub")
    if backend == "stub":
        print(
            "[factory] WARNING: vision backend is STUB. "
            "Set PASTAIO_VISION_BACKEND=ollama or =groq for real identification."
        )
        client: VisionClient = StubVisionClient()
    elif backend == "ollama":
        from app.clients.ollama_vision_client import OllamaVisionClient

        host = os.getenv("PASTAIO_OLLAMA_HOST", "http://localhost:11434")
        model = os.getenv("PASTAIO_OLLAMA_VLM_MODEL", "qwen3-vl:4b")
        client = OllamaVisionClient(model=model, host=host)
    elif backend == "groq":
        from app.clients.groq_vision_client import GroqVisionClient

        model = os.getenv(
            "PASTAIO_GROQ_VLM_MODEL",
            "meta-llama/llama-4-scout-17b-16e-instruct",
        )
        client = GroqVisionClient(model=model)
    else:
        raise ValueError(f"Unknown vision backend: {backend}")

    return wrap_vision_client(client, backend) if _dev_log_enabled() else client


@lru_cache
def get_reasoning_client() -> ReasoningClient:
    backend = os.getenv("PASTAIO_REASONING_BACKEND", "stub")
    if backend == "stub":
        print(
            "[factory] WARNING: reasoning backend is STUB. "
            "Set PASTAIO_REASONING_BACKEND=ollama or =groq for real LLM."
        )
        client: ReasoningClient = StubReasoningClient()
    elif backend == "ollama":
        from app.clients.ollama_client import OllamaClient

        host = os.getenv("PASTAIO_OLLAMA_HOST", "http://localhost:11434")
        model = os.getenv("PASTAIO_OLLAMA_LLM_MODEL", "qwen3.5:4b")
        client = OllamaClient(model=model, host=host)
    elif backend == "groq":
        from app.clients.groq_client import GroqClient

        model = os.getenv("PASTAIO_GROQ_LLM_MODEL", "qwen/qwen3-32b")
        client = GroqClient(model=model)
    else:
        raise ValueError(f"Unknown reasoning backend: {backend}")

    return wrap_reasoning_client(client, backend) if _dev_log_enabled() else client