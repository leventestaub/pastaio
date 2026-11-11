"""Ollama-backed reasoning client for Stage 2.

Wraps Ollama's /api/chat for Qwen2.5:3b. Non-streaming for v1 — keeps the
response shape simple and matches the FastAPI sync-response model.

Tool definitions are converted from our internal ToolDefinition shape to
Ollama's expected OpenAI-style {"type": "function", "function": {...}}
shape here. The conversion is the most fragile part of this client and
will change if Ollama's tool-calling format does — keep it isolated.
"""
import time
from typing import Any

import ollama

from app.clients.base import ReasoningClient
from app.schemas.chat import ChatMessage, ChatResponse
from app.schemas.tools import ToolCall, ToolName

# Qwen2.5:3b sampling. temperature=0.3 because we want the model to follow
# tool-use rules consistently, not be creative about when to call tools.
# top_p=0.9 leaves enough variation that text responses don't feel robotic.
DEFAULT_OPTIONS = {
    "temperature": 0.3,
    "top_p": 0.9,
    "num_ctx": 8192,
}


class OllamaClient(ReasoningClient):
    """Talks to a local Ollama instance running Qwen2.5:3b."""

    def __init__(
        self,
        model: str = "qwen2.5:3b",
        host: str = "http://localhost:11434",
        options: dict[str, Any] | None = None,
    ):
        self.model = model
        self.client = ollama.AsyncClient(host=host)
        self.options = {**DEFAULT_OPTIONS, **(options or {})}
        print(f"[OllamaClient] model={model} host={host} options={self.options}")

    async def chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        tool_definitions: list[dict],
    ) -> ChatResponse:
        ollama_messages = self._build_messages(messages, system_prompt)
        ollama_tools = [_to_ollama_tool(td) for td in tool_definitions]

        start = time.monotonic()
        response = await self.client.chat(
            model=self.model,
            messages=ollama_messages,
            tools=ollama_tools,
            options=self.options,
            think=False,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        return self._parse_response(response, latency_ms)

    @staticmethod
    def _build_messages(
        messages: list[ChatMessage], system_prompt: str
    ) -> list[dict]:
        # System prompt always first. Caller is expected to NOT include a
        # system message in `messages` — chat_service builds it via
        # build_system_prompt and passes it separately.
        out = [{"role": "system", "content": system_prompt}]
        for m in messages:
            msg: dict = {"role": m.role, "content": m.content}
            if m.tool_calls:
                msg["tool_calls"] = [
                    {"function": {"name": c.name.value, "arguments": c.arguments}} for c in m.tool_calls
                ]
            out.append(msg)
        return out

    @staticmethod
    def _parse_response(response: Any, latency_ms: int) -> ChatResponse:
        """Convert Ollama's response shape into our ChatResponse.

        Ollama returns response.message with .content (text) and optionally
        .tool_calls (list of {function: {name, arguments}}). Either may be
        empty. We pass through invalid tool_call names as-is and let the
        chat_service layer handle validation — that way the route can return
        a 422 with a useful error rather than this client raising.
        """
        msg = response.get("message", {}) if isinstance(response, dict) else response.message

        text = _get(msg, "content") or ""
        raw_tool_calls = _get(msg, "tool_calls") or []

        tool_calls: list[ToolCall] = []
        for raw in raw_tool_calls:
            fn = _get(raw, "function") or {}
            name = _get(fn, "name")
            arguments = _get(fn, "arguments") or {}
            if not name:
                continue
            try:
                tool_name = ToolName(name)
            except ValueError:
                # Unknown tool — preserve in latency_ms / log path; for now
                # skip silently. chat_service will be the right place to
                # decide whether to surface this to the client.
                continue
            tool_calls.append(ToolCall(name=tool_name, arguments=arguments))

        return ChatResponse(
            text=text,
            tool_calls=tool_calls,
            latency_ms=latency_ms,
            prompt_tokens=_get(response, "prompt_eval_count"),
            completion_tokens=_get(response, "eval_count"),
        )


def _to_ollama_tool(td: dict) -> dict:
    """Convert internal ToolDefinition.model_dump() to Ollama tool shape.

    Internal: {"name": ToolName.X, "description": "...", "parameters": {...}}
    Ollama:   {"type": "function", "function": {"name", "description", "parameters"}}

    Two cleanups matter for Qwen2.5:3b to reliably use these tools:
      1. Enum names must serialize as strings, not as repr of the enum.
         Pydantic's model_dump() leaves ToolName enums un-unwrapped; we coerce.
      2. Nullable optional fields come out of Pydantic as
         {"anyOf": [{"type": "string"}, {"type": "null"}]}. Small models
         choke on anyOf. Flatten to {"type": "string"} and let absence-from-
         required signal optionality (the OpenAI tool-calling convention).
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
    """Flatten Pydantic-generated JSON Schema for small-model consumption.

    - Collapse `anyOf: [{type: X}, {type: null}]` → `{type: X}`
    - Drop `title` fields (Pydantic adds them everywhere; models don't need them)
    - Drop `default` fields (the model should infer defaults from omission)
    - Recurse into nested properties
    """
    if not isinstance(schema, dict):
        return schema

    # anyOf with null → strip the null, use the non-null branch
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


def _get(obj: Any, key: str) -> Any:
    """Tolerate dict-or-attribute access. Ollama's Python client returns
    pydantic-ish objects in newer versions and dicts in older ones."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)
