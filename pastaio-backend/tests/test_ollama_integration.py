"""Integration tests for Ollama.

Skipped automatically when Ollama isn't reachable so CI and stub-only dev
don't break. Run with a local Ollama + qwen2.5:3b for real coverage.

These tests are not eval — they verify the wire works end to end. Real
prompt/tool reliability evaluation belongs in a separate eval harness.
"""
import os

import httpx
import pytest

from app.clients.ollama_client import OllamaClient
from app.schemas.chat import ChatContext, ChatMessage
from app.schemas.tools import TOOL_DEFINITIONS
from app.services.prompts import build_system_prompt


OLLAMA_HOST = os.getenv("PASTAIO_OLLAMA_HOST", "http://localhost:11434")
LLM_MODEL = os.getenv("PASTAIO_OLLAMA_LLM_MODEL", "qwen2.5:3b")


def _ollama_reachable() -> bool:
    try:
        r = httpx.get(f"{OLLAMA_HOST}/api/tags", timeout=1.0)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _ollama_reachable(),
    reason=f"Ollama not reachable at {OLLAMA_HOST}",
)


@pytest.fixture
def client() -> OllamaClient:
    return OllamaClient(model=LLM_MODEL, host=OLLAMA_HOST)


@pytest.fixture
def tool_definitions() -> list[dict]:
    return [td.model_dump() for td in TOOL_DEFINITIONS]


async def test_greeting_does_not_call_a_tool(client, tool_definitions):
    """Spike 1 rule 2: no tool for greetings/thanks."""
    system_prompt = build_system_prompt(ChatContext())
    response = await client.chat(
        messages=[ChatMessage(role="user", content="Hi!")],
        system_prompt=system_prompt,
        tool_definitions=tool_definitions,
    )
    assert response.tool_calls == [], (
        f"Greeting triggered tool call: {response.tool_calls}"
    )
    assert len(response.text) > 0


async def test_substitution_request_calls_substitution_tool(
    client, tool_definitions
):
    """Hero-moment behavior: substitution request → get_substitution_options."""
    ctx = ChatContext(active_recipe_id="orecchiette-pugliese-01")
    system_prompt = build_system_prompt(ctx)
    response = await client.chat(
        messages=[
            ChatMessage(
                role="user",
                content="I don't have basil. What can I use instead?",
            )
        ],
        system_prompt=system_prompt,
        tool_definitions=tool_definitions,
    )
    tool_names = [tc.name.value for tc in response.tool_calls]
    assert "get_substitution_options" in tool_names, (
        f"Expected get_substitution_options, got {tool_names}, text={response.text!r}"
    )
