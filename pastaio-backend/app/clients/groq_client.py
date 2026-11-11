"""Groq-backed reasoning client for Stage 2.

Wraps Groq's OpenAI-compatible chat endpoint for Qwen3-32B. Mirrors
OllamaClient's interface; only the request/response plumbing differs.

Key Groq-specific quirks:
- Tool call arguments come back as a JSON string (unlike Ollama where
  they come back as a parsed dict). We json.loads() them here.
- Qwen3 family on Groq supports `reasoning_effort='none'` to disable
  reasoning. This is the equivalent of Ollama's `think=False`. Critical:
  Spike 2 / week 2 found thinking mode degrades dispatch reliability
  on small models. Same lesson, same setting, different parameter name.
- Tool definitions use OpenAI's {type: "function", function: {...}}
  shape — same as what we already produce for Ollama via _to_ollama_tool,
  so we reuse the same conversion helper.
"""
import json
import os
import time
from typing import Any

from groq import AsyncGroq

from app.clients.base import ReasoningClient
from app.schemas.chat import ChatMessage, ChatResponse
from app.schemas.tools import ToolCall, ToolName


# Qwen3-32B on Groq. Same temperature philosophy as the Ollama client:
# we want consistent tool-use behavior, not creative variety.
DEFAULT_OPTIONS = {
    "temperature": 0.3,
    "top_p": 0.9,
    # max_tokens caps response length. Groq defaults to model max which
    # is huge; capping helps latency and prevents runaway text on rare
    # bad samples.
    "max_tokens": 2048,
}


class GroqClient(ReasoningClient):
    """Talks to Groq's OpenAI-compatible chat API for Qwen3-32B."""

    def __init__(
        self,
        model: str = "qwen/qwen3.8-27b",
        api_key: str | None = None,
        options: dict[str, Any] | None = None,
    ):
        api_key = api_key or os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY env var not set. "
                "Get a free key at https://console.groq.com"
            )
        self.model = model
        self.client = AsyncGroq(api_key=api_key)
        self.options = {**DEFAULT_OPTIONS, **(options or {})}
        print(f"[GroqClient] model={model} options={self.options}")

    async def chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        tool_definitions: list[dict],
    ) -> ChatResponse:
        groq_messages = self._build_messages(messages, system_prompt)
        groq_tools = [_to_openai_tool(td) for td in tool_definitions]

        start = time.monotonic()
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=groq_messages,
            tools=groq_tools,
            tool_choice="auto",
            # Disable Qwen3's reasoning mode. Same lesson as Ollama
            # think=False: small models dispatch worse with reasoning on.
            reasoning_effort="none",
            **self.options,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        return self._parse_response(response, latency_ms)

    @staticmethod
    def _build_messages(
        messages: list[ChatMessage], system_prompt: str
    ) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system_prompt}]
        for m in messages:
            out.append({"role": m.role, "content": m.content})
        return out

    @staticmethod
    def _parse_response(response: Any, latency_ms: int) -> ChatResponse:
        """Convert Groq's response into our ChatResponse.

        Differences from Ollama:
        - choices[0].message instead of message
        - tool_calls[*].function.arguments is a JSON STRING, must parse
        - tool_calls[*].id is present (we ignore it; not part of our schema)
        """
        msg = response.choices[0].message
        text = msg.content or ""

        tool_calls: list[ToolCall] = []
        for raw in msg.tool_calls or []:
            fn = raw.function
            name = fn.name
            args_raw = fn.arguments or "{}"
            try:
                arguments = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
            except json.JSONDecodeError:
                # Bad JSON from the model — log and skip. Same forgiveness
                # policy as Ollama client: bad calls don't crash the route.
                print(f"[GroqClient] tool {name}: bad JSON arguments: {args_raw!r}")
                continue
            try:
                tool_name = ToolName(name)
            except ValueError:
                print(f"[GroqClient] unknown tool name: {name}")
                continue
            tool_calls.append(ToolCall(name=tool_name, arguments=arguments))

        return ChatResponse(text=text, tool_calls=tool_calls, latency_ms=latency_ms)


def _to_openai_tool(td: dict) -> dict:
    """Convert internal ToolDefinition.model_dump() to OpenAI tool shape.

    Groq is OpenAI-compatible, so this is the same shape Ollama wants
    (our _to_ollama_tool produces it too). Schema simplification is also
    valuable for Qwen3-32B even though it's bigger — cleaner schemas
    yield better dispatch on every small/mid model we've tested.
    """
    name = td["name"]
    if hasattr(name, "value"):
        name = name.value
    return {
        "type": "function",
        "function": {
            "name": str(name),
            "description": td["description"],
            "parameters": _simplify_schema(td["parameters"]),
        },
    }


def _simplify_schema(schema: dict) -> dict:
    """Same simplification as ollama_client._simplify_schema.

    Duplicated rather than imported to keep clients independent — if
    one provider's schema needs change, the other shouldn't have to.
    """
    if not isinstance(schema, dict):
        return schema

    if "anyOf" in schema:
        non_null = [b for b in schema["anyOf"] if b.get("type") != "null"]
        if len(non_null) == 1:
            merged = {**schema, **non_null[0]}
            merged.pop("anyOf", None)
            schema = merged

    cleaned = {}
    for k, v in schema.items():
        if k in ("title", "default"):
            continue
        if k == "properties" and isinstance(v, dict):
            cleaned[k] = {pk: _simplify_schema(pv) for pk, pv in v.items()}
        elif k == "items" and isinstance(v, dict):
            cleaned[k] = _simplify_schema(v)
        else:
            cleaned[k] = v
    return cleaned
