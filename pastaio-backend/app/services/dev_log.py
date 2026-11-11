"""Dev logger: structured, color-coded terminal output for every LLM
interaction.

Goal: when something goes wrong, you can read the terminal scrollback and
reconstruct what the user said, what context was sent, what the model
returned, and how long it took. No log files, no UI — just better print().

Each request gets a 4-char ID so you can grep across the backend terminal
and the Expo Metro terminal to correlate. Print this ID with every log
line related to a single request.

Usage:
    log_id = new_request_id()
    log_user_input(log_id, message, context)
    # ... call LLM ...
    log_llm_response(log_id, "groq", response, latency_ms)

Set PASTAIO_LOG_LEVEL=verbose to see full payloads. Default is "normal"
which truncates long fields.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from datetime import datetime
from typing import Any


# PASTAIO_DEV_LOG=0 silences every function here: the public demo must not log
# visitors' messages. Unhandled errors still reach the server log via uvicorn.
if os.getenv("PASTAIO_DEV_LOG", "1") == "0":
    def print(*args: Any, **kwargs: Any) -> None:  # noqa: A001
        pass


# ANSI colors. No external dep; works in modern Windows terminals (Win10+),
# macOS, Linux. Disabled if NO_COLOR is set or output is not a tty.
_USE_COLOR = (
    sys.stdout.isatty()
    and os.getenv("NO_COLOR") is None
    and os.getenv("PASTAIO_LOG_COLOR", "1") != "0"
)


def _c(code: str, text: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


# Color palette per event type. Chosen to be readable on both light and
# dark terminals: cyan for user (input), yellow for system actions,
# magenta for LLM, green for results, red for errors.
def _user(text: str) -> str:
    return _c("36", text)


def _system(text: str) -> str:
    return _c("33", text)


def _llm(text: str) -> str:
    return _c("35", text)


def _result(text: str) -> str:
    return _c("32", text)


def _err(text: str) -> str:
    return _c("31;1", text)


def _dim(text: str) -> str:
    return _c("2", text)


def _verbose() -> bool:
    return os.getenv("PASTAIO_LOG_LEVEL", "normal").lower() == "verbose"


def new_request_id() -> str:
    """Short ID per /chat or /identify request. Used to correlate
    multi-step traces across backend + app terminals."""
    return secrets.token_hex(2)


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _hdr(rid: str, kind: str, color_fn) -> str:
    return f"{_dim(_ts())} {color_fn(f'[{rid}]')} {color_fn(kind)}"


def _trunc(value: Any, max_chars: int = 400) -> str:
    """Stringify and truncate. Keeps logs readable when payloads are long."""
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if _verbose() or len(s) <= max_chars:
        return s
    return s[:max_chars] + _dim(f"...({len(s) - max_chars} more chars)")


# ---------------------------------------------------------------------------
# Public log functions
# ---------------------------------------------------------------------------


def log_request_start(rid: str, endpoint: str, source_summary: str) -> None:
    """Mark the start of a backend request. Cheap demarcation so the
    terminal scrollback shows clear request boundaries."""
    print()
    print(_dim("─" * 70))
    print(f"{_hdr(rid, '▶ REQUEST', _system)} {endpoint} :: {source_summary}")


def log_user_input(rid: str, message: str, context: Any | None = None) -> None:
    """User message + chat context coming into /chat."""
    print(f"{_hdr(rid, 'USER →', _user)} {_trunc(message, 600)}")
    if context is not None:
        ctx_str = _trunc(context, 400)
        print(f"{_dim(_ts())}        {_dim('context:')} {_dim(ctx_str)}")


def log_image_input(rid: str, size_bytes: int, mime: str = "image/jpeg") -> None:
    """Image upload to /identify. Don't log bytes, just metadata."""
    kb = size_bytes / 1024
    print(f"{_hdr(rid, 'USER →', _user)} {_dim(f'[{mime}, {kb:.0f} KB]')}")


def log_llm_request(
    rid: str,
    backend: str,
    model: str,
    messages_count: int,
    tools_count: int = 0,
) -> None:
    """LLM call going out. We log counts not full payload by default —
    set PASTAIO_LOG_LEVEL=verbose to see everything."""
    extra = f", {tools_count} tools" if tools_count else ""
    print(
        f"{_hdr(rid, 'LLM ←', _llm)} {backend}/{model} "
        f"({messages_count} msgs{extra})"
    )


def log_llm_response(
    rid: str,
    backend: str,
    text: str,
    tool_calls: list[Any],
    latency_ms: int,
    token_usage: dict | None = None,
) -> None:
    """LLM response coming back. Always show text (truncated) and tool
    call summaries; tokens if provider returned them."""
    usage_str = ""
    if token_usage:
        prompt_t = token_usage.get("prompt_tokens", "?")
        completion_t = token_usage.get("completion_tokens", "?")
        usage_str = _dim(f", in={prompt_t} out={completion_t}")
    print(
        f"{_hdr(rid, 'LLM →', _llm)} {backend} "
        f"{_dim(f'({latency_ms}ms{usage_str})')}"
    )
    if text:
        print(f"{_dim(_ts())}        {_dim('text:')} {_trunc(text, 400)}")
    for tc in tool_calls:
        # tool_calls items are ToolCall objects with .name and .arguments.
        name = getattr(tc, "name", None) or (tc.get("name") if isinstance(tc, dict) else "?")
        args = getattr(tc, "arguments", None) or (tc.get("arguments") if isinstance(tc, dict) else {})
        # Stringify ToolName enum if needed.
        name = getattr(name, "value", name)
        print(
            f"{_dim(_ts())}        {_llm('→ tool:')} {name}"
            f"({_trunc(args, 200)})"
        )


def log_vision_response(
    rid: str,
    backend: str,
    shape: str,
    confidence: float,
    alternatives: list[Any],
    latency_ms: int,
) -> None:
    """Stage 1 vision response."""
    alts = ", ".join(f"{s}({c:.2f})" for s, c in alternatives) if alternatives else ""
    alt_str = _dim(f" alts: {alts}") if alts else ""
    print(
        f"{_hdr(rid, 'VLM →', _llm)} {backend} "
        f"{_dim(f'({latency_ms}ms)')} → {shape} "
        f"{_dim(f'({confidence:.2f})')}{alt_str}"
    )


def log_response_returned(rid: str, summary: str = "") -> None:
    """End of a backend request, just before responding to the app."""
    suffix = f" :: {summary}" if summary else ""
    print(f"{_hdr(rid, '◀ DONE', _result)}{suffix}")


def log_error(rid: str, where: str, err: Exception | str) -> None:
    """Anything threw. Caller should still re-raise; this is for visibility."""
    print(f"{_hdr(rid, '✗ ERROR', _err)} in {where}: {err}")


# ---------------------------------------------------------------------------
# Decorator wrappers
# ---------------------------------------------------------------------------


def wrap_reasoning_client(client, backend_name: str):
    """Wrap a ReasoningClient so each .chat() call logs request + response.

    Returns a thin proxy. Doesn't subclass — the wrapped client could be
    any concrete implementation. The proxy needs no per-call rid because
    the route layer creates one and threads it through; for now we just
    log without correlation. (When the route plumbs an rid into the call,
    add an optional kwarg here and use it.)
    """
    original_chat = client.chat
    original_class = type(client).__name__
    model = getattr(client, "model", "?")

    async def wrapped_chat(messages, system_prompt, tool_definitions, _rid: str | None = None):
        rid = _rid or "----"
        log_llm_request(
            rid,
            backend_name,
            model,
            messages_count=len(messages),
            tools_count=len(tool_definitions),
        )
        if _verbose():
            # Verbose: dump messages too. Last user message is usually
            # the most informative.
            for m in messages[-3:]:
                print(f"{_dim(_ts())}        {_dim(f'{m.role}:')} {_trunc(m.content, 300)}")
        try:
            response = await original_chat(messages, system_prompt, tool_definitions)
        except Exception as e:
            log_error(rid, f"{original_class}.chat", e)
            raise
        # token usage isn't part of ChatResponse currently. Providers like
        # Groq surface it — if you want token logs, add a passthrough on
        # ChatResponse and populate it from the client.
        log_llm_response(
            rid,
            backend_name,
            response.text,
            response.tool_calls,
            response.latency_ms,
        )
        return response

    client.chat = wrapped_chat
    return client


def wrap_vision_client(client, backend_name: str):
    """Wrap a VisionClient so each .identify() call logs response."""
    original_identify = client.identify
    original_class = type(client).__name__

    async def wrapped_identify(image_bytes, _rid: str | None = None):
        rid = _rid or "----"
        log_image_input(rid, len(image_bytes))
        try:
            response = await original_identify(image_bytes)
        except Exception as e:
            log_error(rid, f"{original_class}.identify", e)
            raise
        log_vision_response(
            rid,
            backend_name,
            response.shape,
            response.confidence,
            response.alternatives,
            response.latency_ms,
        )
        return response

    client.identify = wrapped_identify
    return client