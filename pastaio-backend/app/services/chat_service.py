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
- feeds invalid calls back as errors, once (one repair attempt);
- blocks substitutions that break a stored restriction and flags
  conflicting recipes the model opens;
- sends back, once, a list of dishes when every search this turn came back
  empty (they come from memory);
- sends back, once, an answer that says the KB lacks something when no
  data tool ran this turn: the model has to check before it abstains.
It stops when the model answers without needing more data, or after
MAX_STEPS model calls. The last call, and a retry after an empty answer,
get no tools, so the turn ends in text rather than a canned fallback.
"""
from __future__ import annotations

import json
import re

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
# "The KB doesn't record that", "the knowledge base has no ..."
UNCHECKED_ABSTAIN = re.compile(
    r"\b(kb|knowledge base)\b[^.]{0,60}?\b(doesn.t|does not|don.t|has no|have no|no record|not (record|list|includ|contain|mention))",
    re.IGNORECASE,
)
LOOK_FIRST = ("You said the knowledge base doesn't have this, but you haven't looked anything up this turn. "
              "Call find_recipes and get_recipe_details first, then answer from what they return.")
# "1. **Penne all'arrabbiata** – Lazio": a dish named in a list
LISTED_DISH = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s+\*\*(.+?)\*\*", re.MULTILINE)
# Qwen sometimes writes a tool call as text when no tools are offered.
TOOL_MARKUP = re.compile(r"<tool_call>|<function=")


def _no_match_text() -> str:
    return ("The knowledge base has no recipes for that. It covers "
            f"{', '.join(kb.shapes_with_recipes())}. Want one of those?")


async def handle_chat(request: ChatRequest, client: ReasoningClient) -> ChatResponse:
    system_prompt = build_system_prompt(request.context)
    tools = tools_for_context(request.context)
    messages = [*request.history, ChatMessage(role="user", content=request.message)]
    actions: list[ToolCall] = []
    trace: list[TraceStep] = []
    repaired = force_text = looked_up = pushed_back = searched = found = False
    text = ""

    for n in range(MAX_STEPS):
        last = n == MAX_STEPS - 1
        reply = await client.chat(messages, system_prompt, [] if last or force_text else tools)
        text = "" if TOOL_MARKUP.search(reply.text) else reply.text
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
                looked_up = True
                if call.name == ToolName.FIND_RECIPES:
                    searched, found = True, found or bool(result["recipes"] or result.get("excluded"))
            elif error := _diet_block(call, request.context.dietary_restrictions):
                result, status, had_error = {"error": error}, "error", True
            else:
                result, status = _ack(call, request.context.dietary_restrictions), "action"
                if not any(a.name == call.name and a.arguments == call.arguments for a in actions):
                    actions.append(call)
                    needs_data = needs_data or "dietary_conflicts" in result  # the model must warn the user
            step.calls.append(TraceCall(name=call.name.value, arguments=call.arguments, status=status,
                                        error=error, summary=_summary(call, status, result)))
            tool_messages.append(ChatMessage(
                role="tool", content=json.dumps(result, ensure_ascii=False), tool_call_id=call.id,
            ))

        done = not needs_data and (not had_error or repaired)
        if done and not (last or looked_up or pushed_back or reply.tool_calls) and UNCHECKED_ABSTAIN.search(text):
            pushed_back = True
            step.guard = "Said the KB lacks it without looking: sent back to look it up"
            messages += [ChatMessage(role="assistant", content=text), ChatMessage(role="user", content=LOOK_FIRST)]
            continue
        if done and searched and not found and (invented := _invented_dishes(text)):
            # every search came back empty, yet the answer lists dishes: they come from memory
            if last or pushed_back:
                text = _no_match_text()
                step.guard = "Listed dishes the KB doesn't have: replaced with what it covers"
                break
            pushed_back = True
            step.guard = "Listed dishes the KB doesn't have: sent back"
            messages += [ChatMessage(role="assistant", content=text), ChatMessage(role="user", content=(
                f"find_recipes returned nothing, so {', '.join(invented)} are not in the knowledge base. "
                "Tell the user the KB has no such recipe and offer the shapes it covers."))]
            continue
        if last or (done and (text or actions or force_text)):
            break
        force_text = done  # empty answer: ask once more, without tools
        repaired = repaired or had_error
        messages += [ChatMessage(role="assistant", content=reply.text, tool_calls=reply.tool_calls), *tool_messages]

    return ChatResponse(
        text=text or ("" if actions else _no_match_text() if searched and not found else FALLBACK_TEXT),
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
        out = {"recipes": recipes, **({"excluded": excluded} if excluded else {})}
        if recipes:
            # weaker fallback models answer from this summary unless told otherwise
            out["note"] = ("Summaries only. Sources, history, regulations, amounts and steps are in "
                           "get_recipe_details: call it before answering a factual question.")
        elif excluded:
            out["note"] = ("Every match conflicts with the user's dietary restrictions (see excluded). "
                           "Say so and name the conflicting ingredients; the KB has no compliant match.")
        else:
            out["note"] = ("No KB recipe matches. Don't name recipes from memory: broaden the search once, "
                           "or tell the user the KB has none and offer the shapes it covers.")
            out["shapes_with_recipes"] = kb.shapes_with_recipes()
        return out
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


def _invented_dishes(text: str) -> list[str]:
    """Dishes listed in `text` that match no KB recipe title."""
    def norm(s: str) -> str:
        return re.sub(r"\W+", "", s.casefold())
    titles = [norm(t) for t in kb.recipe_titles()]
    return [name for name in LISTED_DISH.findall(text)
            if not any(norm(name) in t or t in norm(name) for t in titles)]


def _diet_block(call: ToolCall, restrictions: list) -> str | None:
    """Error for a substitution whose replacement breaks a restriction (fail closed)."""
    if call.name != ToolName.APPLY_SUBSTITUTION or not restrictions:
        return None
    name = call.arguments["replacement"].strip().lower().replace(" ", "_")
    found = diet.conflicts([{"name": name}], restrictions)["conflicts"]
    if not found:
        return None
    return (f"'{call.arguments['replacement']}' conflicts with or cannot be checked against the user's "
            f"restrictions ({', '.join(sorted({c['restriction'] for c in found}))}); not applied. "
            "Offer a replacement from get_substitution_options instead.")


def _ack(call: ToolCall, restrictions: list) -> dict:
    """Action ack; opening or cooking a recipe that breaks a restriction says so."""
    if call.name not in (ToolName.OPEN_RECIPE, ToolName.START_COOKING) or not restrictions:
        return ACTION_ACK
    recipe = kb.get_recipe_details(call.arguments["recipe_id"])
    found = diet.conflicts(recipe["ingredients"], restrictions)["conflicts"] if recipe else []
    if not found:
        return ACTION_ACK
    return {**ACTION_ACK, "dietary_conflicts": found,
            "note": "This recipe breaks the user's restrictions. Tell them which ingredients and offer substitutes."}


def _summary(call: ToolCall, status: str, result: dict) -> str:
    """What the call did, in one line the app can show under the answer."""
    args = call.arguments
    if status == "error":
        if call.name == ToolName.APPLY_SUBSTITUTION and "restrictions" in result["error"]:
            return f"Blocked {args['replacement']}: breaks a dietary restriction"
        return f"Rejected an invalid {call.name.value} call: sent back to fix"
    if call.name == ToolName.FIND_RECIPES:
        what = " ".join(f'"{v}"' for v in (args.get("shape"), args.get("query")) if v)
        found = f"{len(result['recipes'])} found" if result["recipes"] else "nothing found"
        if excluded := result.get("excluded"):
            found += f", {len(excluded)} excluded by your diet"
        return f"Searched the KB for {what or 'recipes'}: {found}"
    if call.name == ToolName.GET_RECIPE_DETAILS:
        if not (recipe := result["recipe"]):
            return "Looked up a recipe the KB doesn't have"
        line = f"Read {recipe['title']} from the KB ({len(recipe['sources'])} sources)"
        if args.get("servings"):
            line += f", amounts scaled to {args['servings']} in code"
        if conflicts := (recipe.get("dietary_check") or {}).get("conflicts"):
            line += f"; conflicts: {', '.join(sorted({c['ingredient'].replace('_', ' ') for c in conflicts}))}"
        return line
    if call.name == ToolName.GET_SUBSTITUTION_OPTIONS:
        n = len(result["options"])
        return f"Checked substitutions for {args['missing_ingredient']}: " + (f"{n} found" if n else "none curated")
    line = {
        ToolName.SET_TIMER: lambda: f"Set a {args['duration_minutes']}-min timer",
        ToolName.OPEN_RECIPE: lambda: f"Opened {_title(args['recipe_id'])}",
        ToolName.START_COOKING: lambda: f"Started cooking {_title(args['recipe_id'])}",
        ToolName.SAVE_TO_COOKBOOK: lambda: f"Saved {_title(args['recipe_id'])} to the cookbook",
        ToolName.SET_DIETARY_RESTRICTION: lambda: f"Remembered: {args['restriction']}",
    }.get(call.name, lambda: call.name.value.replace("_", " ").capitalize())()
    if conflicts := result.get("dietary_conflicts"):
        line += f"; warned about {', '.join(sorted({c['ingredient'].replace('_', ' ') for c in conflicts}))}"
    return line


def _title(recipe_id: str) -> str:
    recipe = kb.get_recipe_details(recipe_id)
    return recipe["title"] if recipe else recipe_id


def _total(trace: list[TraceStep], field: str) -> int | None:
    values = [getattr(s, field) for s in trace]
    return None if None in values else sum(values)
