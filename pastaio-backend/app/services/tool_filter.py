"""Filter tool definitions by ChatContext.

Sending all 14 tool defs every call costs ~3000 tokens. On Groq's free
tier (6K TPM) two consecutive calls easily exceed the limit. Filtering
to the subset actually relevant to the current screen / state cuts that
to ~1200-1800 tokens per call.

Filtering is conservative: when current_screen is unknown, all tools
ship. Better to under-optimize than to under-equip the LLM.

Add new tools to BASELINE_TOOLS unless they have a clear screen-specific
scope. Adding to the right list matters: a tool the LLM needs but doesn't
see can't be called.
"""
from app.schemas.chat import ChatContext
from app.schemas.tools import TOOL_DEFINITIONS, ToolName


# Always available, regardless of screen. The LLM needs these from any
# context — search, navigation, memory writes.
BASELINE_TOOLS: set[ToolName] = {
    ToolName.FIND_RECIPES,
    ToolName.OPEN_RECIPE,
    ToolName.SAVE_TO_COOKBOOK,
    ToolName.SET_DIETARY_RESTRICTION,
    ToolName.NOTE_USER_OBSERVATION,
    ToolName.START_IDENTIFICATION,
    ToolName.OPEN_COOKBOOK,
    ToolName.START_COOKING,
}

# Available when there's a recipe in context (either the user is on a
# recipe/cooking screen, or active_recipe_id is set).
RECIPE_CONTEXT_TOOLS: set[ToolName] = {
    ToolName.GET_RECIPE_DETAILS,
    ToolName.GET_SUBSTITUTION_OPTIONS,
    ToolName.APPLY_SUBSTITUTION,
    ToolName.RATE_RECIPE,
}

# Available only mid-cook.
COOKING_ONLY_TOOLS: set[ToolName] = {
    ToolName.SET_TIMER,
    ToolName.END_COOKING,
}


def tools_for_context(ctx: ChatContext) -> list[dict]:
    """Return the filtered tool definition list for this request.

    Format matches what TOOL_DEFINITIONS produces (already serialized
    via model_dump) — caller passes the result straight to the client.
    """
    allowed = _allowed_tool_names(ctx)
    return [
        td.model_dump(mode="json")
        for td in TOOL_DEFINITIONS
        if td.name in allowed
    ]


def _allowed_tool_names(ctx: ChatContext) -> set[ToolName]:
    """Decide which tools the LLM should see for this request."""
    # Conservative fallback: unknown screen → ship everything.
    if ctx.current_screen is None:
        return {td.name for td in TOOL_DEFINITIONS}

    allowed = set(BASELINE_TOOLS)

    # Recipe-context tools when a recipe is in scope. Either screen
    # implies it, OR an active_recipe_id was resolved by the app.
    if (
        ctx.current_screen in ("recipe", "cooking")
        or ctx.active_recipe_id is not None
    ):
        allowed |= RECIPE_CONTEXT_TOOLS

    # Cooking-only tools strictly require cooking screen. Active recipe
    # alone isn't enough — the user could be viewing a recipe without
    # having started it yet.
    if ctx.current_screen == "cooking":
        allowed |= COOKING_ONLY_TOOLS

    return allowed
