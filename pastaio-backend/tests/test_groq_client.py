"""GroqClient falls back to the next model when one hits its rate limit."""
import asyncio

import httpx
from groq import RateLimitError

from app.clients.groq_client import GroqClient
from app.schemas.chat import ChatMessage


class _Completions:
    def __init__(self, limited):
        self.limited, self.calls = limited, []

    async def create(self, model, **kw):
        self.calls.append((model, kw))
        if model in self.limited:
            raise RateLimitError("quota", response=httpx.Response(429, request=httpx.Request("POST", "http://x")),
                                 body=None)
        msg = type("M", (), {"content": f"from {model}", "tool_calls": None})
        return type("R", (), {"choices": [type("C", (), {"message": msg})], "usage": None})


def _client(limited):
    c = GroqClient(model="qwen/qwen3.8-27b", api_key="test", fallbacks=["openai/gpt-oss-120b", "openai/gpt-oss-20b"])
    c.client = type("G", (), {"chat": type("Ch", (), {"completions": _Completions(limited)})})
    return c


def test_falls_back_in_order_with_per_model_reasoning_effort():
    c = _client({"qwen/qwen3.8-27b"})
    out = asyncio.run(c.chat([ChatMessage(role="user", content="hi")], "sys", []))
    calls = c.client.chat.completions.calls
    assert out.text == "from openai/gpt-oss-120b"
    assert [(m, kw["reasoning_effort"]) for m, kw in calls] == [("qwen/qwen3.8-27b", "none"), ("openai/gpt-oss-120b", "low")]
    assert "tools" not in calls[0][1]  # no tools = text-only call


def test_all_models_limited_raises():
    c = _client({"qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"})
    try:
        asyncio.run(c.chat([ChatMessage(role="user", content="hi")], "sys", []))
    except RateLimitError:
        return
    raise AssertionError("expected RateLimitError")
