"""Locked tool schemas.

Ten tools, finalized after lockdown discussion. Three categories:
  - read tools return data the LLM reasons over
  - write tools commit actions the app executes against local state
  - the dietary restriction tool is structured separately from free-form
    observations because it acts as a hard filter on recipe search

Names are chosen to disambiguate intent for Qwen2.5:3b (per Spike 1 fixes).

The server defines and validates these tools; it does NOT execute write tools.
The app dispatches ToolCall objects against on-device state.
"""
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Tool names
# ---------------------------------------------------------------------------


class ToolName(str, Enum):
    # Read tools
    FIND_RECIPES = "find_recipes"
    GET_RECIPE_DETAILS = "get_recipe_details"
    GET_SUBSTITUTION_OPTIONS = "get_substitution_options"

    # Write tools (state mutations + UI actions)
    OPEN_RECIPE = "open_recipe"
    APPLY_SUBSTITUTION = "apply_substitution"
    SET_TIMER = "set_timer"
    SAVE_TO_COOKBOOK = "save_to_cookbook"
    RATE_RECIPE = "rate_recipe"
    SET_DIETARY_RESTRICTION = "set_dietary_restriction"
    NOTE_USER_OBSERVATION = "note_user_observation"

    # Navigation tools — let the agent reach screens reachable by buttons
    START_IDENTIFICATION = "start_identification"
    OPEN_COOKBOOK = "open_cookbook"
    START_COOKING = "start_cooking"
    END_COOKING = "end_cooking"


# ---------------------------------------------------------------------------
# Supporting enums
# ---------------------------------------------------------------------------


class DietaryRestriction(str, Enum):
    """Hard filters on recipe search. Custom value uses `custom_text`."""
    VEGETARIAN = "vegetarian"
    VEGAN = "vegan"
    GLUTEN_FREE = "gluten_free"
    DAIRY_FREE = "dairy_free"
    PESCATARIAN = "pescatarian"
    NO_PORK = "no_pork"
    NO_SHELLFISH = "no_shellfish"
    CUSTOM = "custom"


class ObservationCategory(str, Enum):
    """Soft grouping for the memory tab. LLM picks; app uses for display."""
    FOOD = "food"
    INTERACTION = "interaction"
    DIETARY = "dietary"
    REGIONAL = "regional"
    COOKING_STYLE = "cooking_style"
    OTHER = "other"


# ---------------------------------------------------------------------------
# Per-tool argument models
# ---------------------------------------------------------------------------
# Used to validate `ToolCall.arguments` server-side before returning to the app.
# The LLM sees JSON Schema (generated below); the app gets validated objects.


class FindRecipesArgs(BaseModel):
    shape: str | None = None
    query: str | None = None


class GetRecipeDetailsArgs(BaseModel):
    recipe_id: str


class GetSubstitutionOptionsArgs(BaseModel):
    missing_ingredient: str
    recipe_id: str | None = None  # context-aware substitution when provided


class OpenRecipeArgs(BaseModel):
    recipe_id: str


class ApplySubstitutionArgs(BaseModel):
    recipe_id: str
    original: str
    replacement: str


class SetTimerArgs(BaseModel):
    duration_minutes: int = Field(..., gt=0)
    label: str | None = None


class SaveToCookbookArgs(BaseModel):
    recipe_id: str


class RateRecipeArgs(BaseModel):
    recipe_id: str
    rating: int = Field(..., ge=1, le=5)
    note: str | None = None


class SetDietaryRestrictionArgs(BaseModel):
    restriction: DietaryRestriction
    custom_text: str | None = None  # required when restriction == CUSTOM


class NoteUserObservationArgs(BaseModel):
    observation: str
    category: ObservationCategory
    context: str


class StartIdentificationArgs(BaseModel):
    """No arguments — opens the camera/identification flow."""
    pass


class OpenCookbookArgs(BaseModel):
    """No arguments — opens the cookbook tab."""
    pass


class StartCookingArgs(BaseModel):
    """Open the cooking screen for a specific recipe."""
    recipe_id: str


class EndCookingArgs(BaseModel):
    """No arguments — exits cooking mode and returns to the previous screen."""
    pass


TOOL_ARG_MODELS: dict[ToolName, type[BaseModel]] = {
    ToolName.FIND_RECIPES: FindRecipesArgs,
    ToolName.GET_RECIPE_DETAILS: GetRecipeDetailsArgs,
    ToolName.GET_SUBSTITUTION_OPTIONS: GetSubstitutionOptionsArgs,
    ToolName.OPEN_RECIPE: OpenRecipeArgs,
    ToolName.APPLY_SUBSTITUTION: ApplySubstitutionArgs,
    ToolName.SET_TIMER: SetTimerArgs,
    ToolName.SAVE_TO_COOKBOOK: SaveToCookbookArgs,
    ToolName.RATE_RECIPE: RateRecipeArgs,
    ToolName.SET_DIETARY_RESTRICTION: SetDietaryRestrictionArgs,
    ToolName.NOTE_USER_OBSERVATION: NoteUserObservationArgs,
    ToolName.START_IDENTIFICATION: StartIdentificationArgs,
    ToolName.OPEN_COOKBOOK: OpenCookbookArgs,
    ToolName.START_COOKING: StartCookingArgs,
    ToolName.END_COOKING: EndCookingArgs,
}


# ---------------------------------------------------------------------------
# Tool call envelope
# ---------------------------------------------------------------------------


class ToolCall(BaseModel):
    """A single tool invocation the app should execute.

    `arguments` is kept as dict here so the chat response wire format matches
    what Ollama emits. Use `validate_tool_call` to type-check before dispatch.
    """
    name: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)


def validate_tool_call(call: ToolCall) -> BaseModel:
    """Validate a tool call's arguments against its typed model.

    Raises pydantic.ValidationError on bad arguments. Server should call this
    on every LLM-emitted tool call before returning the response to the app.
    """
    model = TOOL_ARG_MODELS[call.name]
    return model.model_validate(call.arguments)


# ---------------------------------------------------------------------------
# Tool definitions for the LLM
# ---------------------------------------------------------------------------
# Descriptions are written for Qwen2.5:3b: short, action-oriented, and
# disambiguating between similar tools.


class ToolDefinition(BaseModel):
    """Server-side definition of a tool, sent to the LLM in its system context."""
    name: ToolName
    description: str
    parameters: dict[str, Any]  # JSON Schema fragment


def _schema_for(model: type[BaseModel]) -> dict[str, Any]:
    """Strip Pydantic's title noise from generated JSON Schema."""
    schema = model.model_json_schema()
    schema.pop("title", None)
    return schema


TOOL_DEFINITIONS: list[ToolDefinition] = [
    ToolDefinition(
        name=ToolName.FIND_RECIPES,
        description=(
            "Search the recipe collection. Filter by pasta shape and/or "
            "search by free-text terms in the title or description. "
            "Returns up to 10 matching recipes with id, title, region, and "
            "cook time. Call get_recipe_details for full ingredients and steps."
        ),
        parameters=_schema_for(FindRecipesArgs),
    ),
    ToolDefinition(
        name=ToolName.GET_RECIPE_DETAILS,
        description=(
            "Fetch full details for one recipe by ID: ingredients with "
            "quantities, steps, cook time, region, traditional pairings. "
            "Use when the user asks specifics about a recipe you have not "
            "already loaded."
        ),
        parameters=_schema_for(GetRecipeDetailsArgs),
    ),
    ToolDefinition(
        name=ToolName.GET_SUBSTITUTION_OPTIONS,
        description=(
            "Look up substitution candidates for a missing ingredient from "
            "the curated knowledge base. Returns options with culinary "
            "reasoning. Pass recipe_id when the substitution depends on the "
            "dish. Always call this before suggesting a substitution — do "
            "not invent substitutions from general knowledge."
        ),
        parameters=_schema_for(GetSubstitutionOptionsArgs),
    ),
    ToolDefinition(
        name=ToolName.OPEN_RECIPE,
        description=(
            "Navigate the app to a recipe page by ID. Call this when the user "
            "wants to view a recipe by name or ID — '/open carbonara/', "
            "'show me the gricia', etc. If you don't have a literal recipe_id, "
            "call find_recipes first to discover one. Do NOT use find_recipes "
            "as a substitute for navigation."
        ),
        parameters=_schema_for(OpenRecipeArgs),
    ),
    ToolDefinition(
        name=ToolName.APPLY_SUBSTITUTION,
        description=(
            "Commit an ingredient substitution to the active recipe. "
            "Updates the displayed ingredient list. Only call after the "
            "user has confirmed the substitution."
        ),
        parameters=_schema_for(ApplySubstitutionArgs),
    ),
    ToolDefinition(
        name=ToolName.SET_TIMER,
        description=(
            "Start one cooking timer. Requires the user to be in cooking "
            "mode — call start_cooking first if current_screen is not "
            "'cooking'. For multiple timers, call this tool multiple times."
        ),
        parameters=_schema_for(SetTimerArgs),
    ),
    ToolDefinition(
        name=ToolName.SAVE_TO_COOKBOOK,
        description="Save a recipe to the user's personal cookbook.",
        parameters=_schema_for(SaveToCookbookArgs),
    ),
    ToolDefinition(
        name=ToolName.RATE_RECIPE,
        description=(
            "Record a 1-5 rating for a recipe the user has cooked. Include "
            "the user's note verbatim if they gave one."
        ),
        parameters=_schema_for(RateRecipeArgs),
    ),
    ToolDefinition(
        name=ToolName.SET_DIETARY_RESTRICTION,
        description=(
            "Record a hard dietary restriction that filters all future "
            "recipe searches. Use only for firm restrictions the user "
            "stated explicitly. Use the 'custom' value with custom_text "
            "for restrictions outside the listed set. For soft preferences "
            "(likes, dislikes, tendencies), use note_user_observation "
            "instead."
        ),
        parameters=_schema_for(SetDietaryRestrictionArgs),
    ),
    ToolDefinition(
        name=ToolName.NOTE_USER_OBSERVATION,
        description=(
            "Record a non-obvious observation about the user that will "
            "inform future interactions. Examples: a substitution they "
            "preferred, a regional cuisine they keep returning to, an "
            "interaction pattern (likes step-by-step mode), a stated "
            "opinion. Do NOT log obvious things (they opened a cooking "
            "app, they cooked once). Pick the most specific category. "
            "Include context describing when and where the observation "
            "was made."
        ),
        parameters=_schema_for(NoteUserObservationArgs),
    ),
    ToolDefinition(
        name=ToolName.START_IDENTIFICATION,
        description=(
            "Open the pasta identification camera flow. Call this when the "
            "user wants to identify a pasta shape, asks 'what is this?' "
            "about pasta, or wants to scan/photograph pasta. Takes no "
            "arguments."
        ),
        parameters=_schema_for(StartIdentificationArgs),
    ),
    ToolDefinition(
        name=ToolName.OPEN_COOKBOOK,
        description=(
            "Open the user's saved cookbook. Call this when the user wants "
            "to browse, view, or look through their saved recipes. Takes "
            "no arguments. Do NOT call this for searching the full recipe "
            "database — use find_recipes for that."
        ),
        parameters=_schema_for(OpenCookbookArgs),
    ),
    ToolDefinition(
        name=ToolName.START_COOKING,
        description=(
            "Begin cooking a specific recipe. Opens the step-by-step "
            "cooking screen and initializes a fresh cooking session. "
            "Call this when the user wants to start cooking, or before "
            "calling set_timer if the user is not yet in cooking mode. "
            "Pass the recipe_id; if the user said 'this one' or 'that "
            "recipe', use active_recipe_id from Context."
        ),
        parameters=_schema_for(StartCookingArgs),
    ),
    ToolDefinition(
        name=ToolName.END_COOKING,
        description=(
            "Exit cooking mode. Call this when the user says they're done, "
            "finished, or want to stop cooking. Takes no arguments. Only "
            "valid when current_screen is 'cooking'."
        ),
        parameters=_schema_for(EndCookingArgs),
    ),
]
