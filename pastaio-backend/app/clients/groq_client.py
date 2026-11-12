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
- The free tier caps tokens per minute (8k) and per day, per model. On a
  rate limit the client moves on to the next model in `fallbacks`; when all
  are limited for a few seconds only (per-minute cap) it waits once and
  tries again. A daily cap waits much longer, so that raises (-> 503).
"""
import asyncio
import json
import os
import time
from typing import Any

from groq import AsyncGroq, BadRequestError, RateLimitError

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
MAX_WAIT_S = 20  # longest per-minute rate-limit wait worth holding a chat request for


class GroqClient(ReasoningClient):
    """Talks to Groq's OpenAI-compatible chat API for Qwen3-32B."""

    def __init__(
        self,
        model: str = "qwen/qwen3.8-27b",
        api_key: str | None = None,
        options: dict[str, Any] | None = None,
        fallbacks: list[str] | None = None,
    ):
        api_key = api_key or os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY env var not set. "
                "Get a free key at https://console.groq.com"
            )
        self.model = model
        self.models = [model, *(fallbacks or [])]
        # No SDK retries when there is a fallback: a 429 should switch model, not wait.
        self.client = AsyncGroq(api_key=api_key, **({"max_retries": 0} if fallbacks else {}))
        self.options = {**DEFAULT_OPTIONS, **(options or {})}
        print(f"[GroqClient] models={self.models} options={self.options}")

    async def chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        tool_definitions: list[dict],
    ) -> ChatResponse:
        groq_messages = self._build_messages(messages, system_prompt)
        # No tools = the agent loop wants a text answer.
        tools = {"tools": [_to_openai_tool(td) for td in tool_definitions], "tool_choice": "auto"}             if tool_definitions else {}

        start = time.monotonic()
        response = None
        for attempt in range(2):
            waits = []
            for model in self.models:
                try:
                    response = await self._create(model, groq_messages, tools)
                    break
                except RateLimitError as e:
                    print(f"[GroqClient] {model} rate limited")
                    last, waits = e, [*waits, float(e.response.headers.get("retry-after") or 3600)]
                except BadRequestError as e:
                    # still rejected after _create's retry: another model may comply
                    if "tool_use_failed" not in str(e):
                        raise
                    print(f"[GroqClient] {model} tool call rejected")
                    last = e
            if response is not None:
                break
            if attempt or not waits or min(waits) > MAX_WAIT_S:
                if isinstance(last, BadRequestError) and not tools:
                    # every model insists on a tool when none is offered: an empty
                    # answer lets the agent loop end the turn in text, not a 502
                    return ChatResponse(text="", tool_calls=[], latency_ms=int((time.monotonic() - start) * 1000))
                raise last
            await asyncio.sleep(min(waits))
        latency_ms = int((time.monotonic() - start) * 1000)

        return self._parse_response(response, latency_ms)

    async def _create(self, model: str, messages: list[dict], tools: dict) -> Any:
        # Groq rejects the whole generation when the model calls a tool that
        # isn't offered (tool_use_failed), e.g. gpt-oss calling one on the
        # text-only last step. Sample again, telling the model why.
        for attempt in range(2):
            try:
                return await self.client.chat.completions.create(
                    model=model, messages=messages, **tools, **_effort(model, self.model), **self.options,
                )
            except BadRequestError as e:
                if attempt == 1 or "tool_use_failed" not in str(e):
                    raise
                hint = "Only call the tools you were given." if tools else \
                    "No tools are available now: answer in plain text from the results above."
                messages = [*messages, {"role": "user", "content": f"(Your last reply was rejected. {hint})"}]

    @staticmethod
    def _build_messages(
        messages: list[ChatMessage], system_prompt: str
    ) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system_prompt}]
        for m in messages:
            msg: dict = {"role": m.role, "content": m.content}
            if m.tool_calls:
                msg["tool_calls"] = [
                    {"id": c.id, "type": "function",
                     "function": {"name": c.name.value, "arguments": json.dumps(c.arguments)}}
                    for c in m.tool_calls
                ]
            if m.tool_call_id:
                msg["tool_call_id"] = m.tool_call_id
            out.append(msg)
        return out

    @staticmethod
    def _parse_response(response: Any, latency_ms: int) -> ChatResponse:
        """Convert Groq's response into our ChatResponse.

        Differences from Ollama:
        - choices[0].message instead of message
        - tool_calls[*].function.arguments is a JSON STRING, must parse
        - tool_calls[*].id is present; kept so tool results can reference it
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
            tool_calls.append(ToolCall(name=tool_name, arguments=arguments, id=raw.id))

        usage = getattr(response, "usage", None)
        return ChatResponse(
            text=text,
            tool_calls=tool_calls,
            latency_ms=latency_ms,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
        )


def _effort(model: str, primary: str) -> dict:
    """Reasoning off where the model allows it: small and mid models dispatch
    worse with reasoning on (same lesson as Ollama think=False). gpt-oss has
    no "none", so "low". PASTAIO_GROQ_REASONING_EFFORT overrides the primary."""
    if model == primary and os.getenv("PASTAIO_GROQ_REASONING_EFFORT"):
        return {"reasoning_effort": os.environ["PASTAIO_GROQ_REASONING_EFFORT"]}
    if "qwen" in model:
        return {"reasoning_effort": "none"}
    return {"reasoning_effort": "low"} if "gpt-oss" in model else {}


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
    """Same simplification as ollama_client._simplify_schema, except that
    optional fields stay nullable.

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
            # Stay nullable: Groq validates calls against this schema, and
            # gpt-oss sends null for optional arguments it doesn't use.
            if len(non_null) < len(schema["anyOf"]) and isinstance(merged.get("type"), str):
                merged["type"] = [merged["type"], "null"]
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
