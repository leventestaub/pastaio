"""GroqClient falls back to the next model when one hits its rate limit."""
import asyncio

import httpx
from groq import RateLimitError

from app.clients.groq_client import GroqClient
from app.schemas.chat import ChatMessage


class _Completions:
    def __init__(self, limited, retry_after):
        self.limited, self.retry_after, self.calls = limited, retry_after, []

    async def create(self, model, **kw):
        self.calls.append((model, kw))
        if self.limited.get(model):
            self.limited[model] -= 1
            response = httpx.Response(429, headers={"retry-after": self.retry_after},
                                      request=httpx.Request("POST", "http://x"))
            raise RateLimitError("quota", response=response, body=None)
        msg = type("M", (), {"content": f"from {model}", "tool_calls": None})
        return type("R", (), {"choices": [type("C", (), {"message": msg})], "usage": None})


MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]


def _client(limited, retry_after="3600"):
    """limited: model -> how many calls fail with a 429 before it answers."""
    c = GroqClient(model=MODELS[0], api_key="test", fallbacks=MODELS[1:])
    c.client = type("G", (), {"chat": type("Ch", (), {"completions": _Completions(limited, retry_after)})})
    return c


def _ask(c):
    return asyncio.run(c.chat([ChatMessage(role="user", content="hi")], "sys", []))


def test_falls_back_in_order_with_per_model_reasoning_effort():
    c = _client({MODELS[0]: 9})
    out = _ask(c)
    calls = c.client.chat.completions.calls
    assert out.text == "from openai/gpt-oss-120b"
    assert [(m, kw["reasoning_effort"]) for m, kw in calls] == [("qwen/qwen3.8-27b", "none"), ("openai/gpt-oss-120b", "low")]
    assert "tools" not in calls[0][1]  # no tools = text-only call


def test_short_limit_on_every_model_waits_once_and_retries():
    c = _client(dict.fromkeys(MODELS, 1), retry_after="0")
    assert _ask(c).text == "from qwen/qwen3.8-27b"
    assert len(c.client.chat.completions.calls) == 4


def test_daily_cap_on_every_model_raises_without_waiting():
    c = _client(dict.fromkeys(MODELS, 9))
    try:
        _ask(c)
    except RateLimitError:
        assert len(c.client.chat.completions.calls) == 3
        return
    raise AssertionError("expected RateLimitError")
