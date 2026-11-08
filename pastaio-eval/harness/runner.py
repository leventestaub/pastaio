"""Run a Case against the live backend and produce a CaseTrace.

The runner is deliberately thin: it owns state, calls the backend once
per turn, dispatches tool calls into state, and hands off to asserts.

Wire shape (matches `app/schemas/chat.py`):
  request  = { message: str, history: ChatMessage[], context: ChatContext }
  response = { text: str, tool_calls: ToolCall[], latency_ms: int }

Multi-turn: `history` carries prior real user + assistant turns. The
backend's own loop in `chat_service.handle_chat` handles intra-turn
tool-result feedback; the harness never injects synthetic "Tool results:"
messages -- those live inside one /chat call, not across them.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

import httpx
import yaml

from .asserts import evaluate_turn
from .context import build_chat_context
from .dispatcher import EvalDispatcher
from .schema import (
    Case,
    CaseTrace,
    DispatchedTool,
    Turn,
    TurnTrace,
)
from .state import SimulatedState


class CaseRunner:
    def __init__(
        self,
        backend_url: str,
        dispatcher: EvalDispatcher,
        timeout_s: float = 30.0,
    ):
        self.backend_url = backend_url.rstrip("/")
        self.dispatcher = dispatcher
        self.timeout_s = timeout_s

    def run_case(self, case: Case, repeat_index: int = 0) -> CaseTrace:
        state = SimulatedState(case.initial_state)
        started_at = datetime.utcnow()

        # Wire-format conversation history. Each entry is a ChatMessage
        # ({role, content}). We append the user turn AFTER the call (the
        # current message goes in `message`, not in `history`), and the
        # assistant's text response so the next turn sees it.
        history: list[dict[str, str]] = []
        turn_traces: list[TurnTrace] = []
        case_failure: str | None = None

        for turn_idx, turn in enumerate(case.turns):
            if turn.state_override:
                self._apply_state_override(state, turn.state_override)

            try:
                trace = self._run_turn(turn, state, history)
            except Exception as e:
                case_failure = f"turn {turn_idx} ({turn.user_input!r}): {e}"
                break

            turn_traces.append(trace)
            # Continue running the rest of the conversation even if this
            # turn failed assertions -- a failed assertion doesn't break
            # the wire, only the case verdict.

        case_passed = (
            case_failure is None
            and len(turn_traces) == len(case.turns)
            and all(t.turn_passed for t in turn_traces)
        )

        return CaseTrace(
            case_id=case.case_id,
            category=case.category,
            repeat_index=repeat_index,
            started_at=started_at,
            finished_at=datetime.utcnow(),
            turn_traces=turn_traces,
            case_passed=case_passed,
            failure_reason=case_failure,
        )

    # ---------- Per-turn execution ----------

    def _run_turn(
        self,
        turn: Turn,
        state: SimulatedState,
        history: list[dict[str, str]],
    ) -> TurnTrace:
        state_before = state.to_dict()
        chat_context = build_chat_context(state)

        t0 = time.perf_counter()
        response = self._call_backend(turn.user_input, history, chat_context)
        round_trip_ms = int((time.perf_counter() - t0) * 1000)

        # Backend reports its own inference latency; prefer that for the
        # trace and keep round-trip as a sanity check (~= inference + RTT).
        latency_ms = int(response.get("latency_ms") or round_trip_ms)
        text = response.get("text", "") or ""
        tool_calls = response.get("tool_calls", []) or []

        # Update history *before* dispatching tools so that even if a tool
        # raises, the next turn sees a coherent conversation.
        history.append({"role": "user", "content": turn.user_input})
        history.append({"role": "assistant", "content": text})

        dispatched: list[DispatchedTool] = []
        for tc in tool_calls:
            d = self.dispatcher.dispatch(
                tool_name=_tool_name(tc),
                args=_tool_args(tc),
                state=state,
            )
            dispatched.append(d)

        # Record the assistant text in raw_assistant_messages so the trace
        # JSON has it for hand-grading rubric assertions later.
        raw_assistant_messages = [{"role": "assistant", "content": text}]

        results = evaluate_turn(turn.asserts, dispatched, state)
        passed = all(r.passed for r in results) if results else True

        return TurnTrace(
            user_input=turn.user_input,
            chat_context_snapshot=chat_context,
            raw_assistant_messages=raw_assistant_messages,
            dispatched_tools=dispatched,
            state_before=state_before,
            state_after=state.to_dict(),
            assertion_results=results,
            turn_passed=passed,
            latency_ms=latency_ms,
        )

    # ---------- Wire ----------

    def _call_backend(
        self,
        message: str,
        history: list[dict[str, str]],
        chat_context: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "message": message,
            "history": history,
            "context": chat_context,
        }
        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(f"{self.backend_url}/chat", json=payload)
            r.raise_for_status()
            return r.json()

    # ---------- Helpers ----------

    @staticmethod
    def _apply_state_override(state: SimulatedState, override: dict[str, Any]) -> None:
        for k, v in override.items():
            if hasattr(state, k):
                setattr(state, k, v)


# ---------- ToolCall normalization ----------
#
# Pydantic's ToolCall has been emitted in different forms across the
# project's history (see DECISIONS.md: Groq returns args as JSON strings,
# Ollama returns dicts). The backend's ToolCall model normalizes this --
# but if the tool_calls field comes back as raw OpenAI-style with a
# `function: {name, arguments}` shape, the harness should still cope.


def _tool_name(tc: dict[str, Any]) -> str:
    if "name" in tc:
        return tc["name"]
    if "function" in tc and isinstance(tc["function"], dict):
        return tc["function"].get("name", "")
    return ""


def _tool_args(tc: dict[str, Any]) -> dict[str, Any]:
    args = tc.get("args") or tc.get("arguments")
    if args is None and "function" in tc and isinstance(tc["function"], dict):
        args = tc["function"].get("arguments")
    if isinstance(args, str):
        # Groq emits arguments as a JSON string; the backend usually
        # parses these but if anything leaks through, parse defensively.
        import json

        try:
            args = json.loads(args)
        except Exception:
            args = {}
    return dict(args or {})


# ---------- YAML case loading ----------


def load_case_from_yaml(path: str) -> Case:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return Case.model_validate(raw)
