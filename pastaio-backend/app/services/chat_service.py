"""Chat orchestration: the agent loop.

One /chat request = one user turn. The loop:
- calls the model with the screen's tools (app.services.tool_filter keeps
  the tool list small for Groq's free tier);
- validates every tool call (argument types via validate_tool_call, recipe
  IDs against the KB, fuzzy-resolving near misses);
- runs data tools here, against the KB, and feeds the results back as
  tool-role messages;
- collects action tools (navigation, timers, cookbook writes) for the app,
  which owns that state, and tells the model they were handed over;
- feeds invalid calls back as errors, once (one repair attempt).
It stops when the model answers without needing more data, or after
MAX_STEPS model calls.
"""
from __future__ import annotations

import json

from pydantic import ValidationError

from app.clients.base import ReasoningClient
from app.schemas.chat import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    TraceCall,
    TraceStep,
)
from app.schemas.tools import ToolCall, ToolName, validate_tool_call
from app.services import diet, kb
from app.services.prompts import build_system_prompt
from app.services.tool_filter import tools_for_context

MAX_STEPS = 4
DATA_TOOLS = {ToolName.FIND_RECIPES, ToolName.GET_RECIPE_DETAILS, ToolName.GET_SUBSTITUTION_OPTIONS}
ACTION_ACK = {"status": "handed to the app, which carries it out"}
FALLBACK_TEXT = "Sorry, I couldn't work that out. Could you rephrase?"


async def handle_chat(request: ChatRequest, client: ReasoningClient) -> ChatResponse:
    system_prompt = build_system_prompt(request.context)
    tools = tools_for_context(request.context)
    messages = [*request.history, ChatMessage(role="user", content=request.message)]
    actions: list[ToolCall] = []
    trace: list[TraceStep] = []
    repaired = False
    text = ""

    for _ in range(MAX_STEPS):
        reply = await client.chat(messages, system_prompt, tools)
        text = reply.text
        step = TraceStep(
            latency_ms=reply.latency_ms,
            prompt_tokens=reply.prompt_tokens,
            completion_tokens=reply.completion_tokens,
        )
        trace.append(step)

        tool_messages, needs_data, had_error = [], False, False
        for i, call in enumerate(reply.tool_calls):
            call.id = call.id or f"call_{len(trace)}_{i}"
            error = _check(call)
            if error:
                result, status, had_error = {"error": error}, "error", True
            elif call.name in DATA_TOOLS:
                result, status, needs_data = _run_data_tool(call, request.context.dietary_restrictions), "ok", True
            else:
                result, status = ACTION_ACK, "action"
                if not any(a.name == call.name and a.arguments == call.arguments for a in actions):
                    actions.append(call)
            step.calls.append(TraceCall(name=call.name.value, arguments=call.arguments, status=status, error=error))
            tool_messages.append(ChatMessage(
                role="tool", content=json.dumps(result, ensure_ascii=False), tool_call_id=call.id,
            ))

        if not needs_data and (not had_error or repaired):
            break
        repaired = repaired or had_error
        messages += [ChatMessage(role="assistant", content=reply.text, tool_calls=reply.tool_calls), *tool_messages]

    return ChatResponse(
        text=text or ("" if actions else FALLBACK_TEXT),
        tool_calls=actions,
        latency_ms=sum(s.latency_ms for s in trace),
        prompt_tokens=_total(trace, "prompt_tokens"),
        completion_tokens=_total(trace, "completion_tokens"),
        trace=trace,
    )


def _check(call: ToolCall) -> str | None:
    """Error message for the model, or None. Rewrites near-miss recipe IDs in place."""
    try:
        validate_tool_call(call)
    except ValidationError as e:
        return "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors())
    if call.arguments.get("recipe_id") is None:
        return None
    resolved = kb.resolve_recipe_id(call.arguments["recipe_id"])
    if resolved:
        call.arguments["recipe_id"] = resolved
    elif call.name == ToolName.GET_SUBSTITUTION_OPTIONS:
        del call.arguments["recipe_id"]  # optional refinement: fall back to general rules
    else:
        return (f"recipe_id '{call.arguments['recipe_id']}' does not exist. "
                "Use active_recipe_id from Context or call find_recipes for real IDs.")
    return None


def _run_data_tool(call: ToolCall, restrictions: list) -> dict:
    """Run a data tool; dietary restrictions from Context act as hard filters."""
    args = call.arguments
    if call.name == ToolName.FIND_RECIPES:
        shape = args.get("shape")
        recipes, excluded = [], []
        for r in kb.find_recipes(shape_id=shape.lower() if shape else None, query=args.get("query")):
            found = diet.conflicts([{"name": n} for n in r["ingredient_names"]], restrictions)["conflicts"]
            if found:
                excluded.append({"recipe_id": r["recipe_id"], "title": r["title"], "conflicts": found})
            else:
                recipes.append(r)
        return {"recipes": recipes, **({"excluded": excluded} if excluded else {})}
    if call.name == ToolName.GET_RECIPE_DETAILS:
        recipe = kb.get_recipe_details(args["recipe_id"])
        if recipe and args.get("servings"):
            recipe["ingredients"] = kb.scale_ingredients(recipe["ingredients"], recipe["serves"], args["servings"])
            recipe["serves"] = args["servings"]
        if recipe and restrictions:
            recipe["dietary_check"] = diet.conflicts(recipe["ingredients"], restrictions)
        return {"recipe": recipe}
    options = kb.get_substitution_options(args["missing_ingredient"], args.get("recipe_id"))
    return {
        "options": [o for o in options if not diet.conflicts([{"name": o["replacement"]}], restrictions)["conflicts"]],
        "missing_ingredient": args["missing_ingredient"],
    }


def _total(trace: list[TraceStep], field: str) -> int | None:
    values = [getattr(s, field) for s in trace]
    return None if None in values else sum(values)
