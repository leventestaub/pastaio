"""GroqClient falls back to the next model when one hits its rate limit
or keeps calling a tool it wasn't offered."""
import asyncio

import httpx
from groq import BadRequestError, RateLimitError

from app.clients.groq_client import GroqClient
from app.schemas.chat import ChatMessage


class _Completions:
    def __init__(self, limited, retry_after, rejects=()):
        self.limited, self.retry_after, self.rejects, self.calls = limited, retry_after, rejects, []

    async def create(self, model, **kw):
        self.calls.append((model, kw))
        if self.limited.get(model):
            self.limited[model] -= 1
            response = httpx.Response(429, headers={"retry-after": self.retry_after},
                                      request=httpx.Request("POST", "http://x"))
            raise RateLimitError("quota", response=response, body=None)
        if model in self.rejects:
            response = httpx.Response(400, request=httpx.Request("POST", "http://x"))
            raise BadRequestError("tool_use_failed: Tool choice is none, but model called a tool",
                                  response=response, body=None)
        msg = type("M", (), {"content": f"from {model}", "tool_calls": None})
        return type("R", (), {"choices": [type("C", (), {"message": msg})], "usage": None})


MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]


def _client(limited, retry_after="3600", rejects=()):
    """limited: model -> how many calls fail with a 429 before it answers.
    rejects: models whose every reply Groq rejects as tool_use_failed."""
    c = GroqClient(model=MODELS[0], api_key="test", fallbacks=MODELS[1:])
    completions = _Completions(limited, retry_after, rejects)
    c.client = type("G", (), {"chat": type("Ch", (), {"completions": completions})})
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


def test_rejected_tool_call_retries_with_a_hint_then_next_model():
    c = _client({}, rejects=[MODELS[0]])
    assert _ask(c).text == "from openai/gpt-oss-120b"
    calls = c.client.chat.completions.calls
    assert [m for m, _ in calls] == [MODELS[0], MODELS[0], MODELS[1]]
    assert "plain text" in calls[1][1]["messages"][-1]["content"]


def test_optional_arguments_stay_nullable():
    from app.clients.groq_client import _to_openai_tool
    from app.schemas.tools import TOOL_DEFINITIONS
    params = _to_openai_tool(TOOL_DEFINITIONS[0].model_dump())["function"]["parameters"]
    assert params["properties"]["shape"]["type"] == ["string", "null"]
