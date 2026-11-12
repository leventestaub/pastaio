"""Stage 2 agentic chat schemas."""
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.tools import (
    DietaryRestriction,
    ObservationCategory,
    ToolCall,
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    # Only set inside the server's agent loop. The app sends plain text turns.
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_call_id: str | None = None


class StoredObservation(BaseModel):
    """A single entry from the user's observation log, surfaced back to the LLM."""
    observation: str
    category: ObservationCategory
    context: str


class StoredDietaryRestriction(BaseModel):
    restriction: DietaryRestriction
    custom_text: str | None = None


class CookingStep(BaseModel):
    number: int = Field(..., description="1-based step number shown on screen")
    total: int
    text: str


class ActiveTimer(BaseModel):
    label: str | None = None
    remaining_seconds: int


class ChatContext(BaseModel):
    """Context the app sends with each request.

    The server is stateless. The app owns all state and ships the relevant
    slice on every turn. Per the Spike 2 multi-turn finding, the app resolves
    references ("that recipe", "it") to concrete IDs before sending —
    `active_recipe_id` is the result of that resolution.

    Fields here exist instead of as tools because they apply to every turn;
    making them tools would force the LLM to fetch them, burning dispatch
    budget on retrieval that should be free.
    """
    active_recipe_id: str | None = None
    active_shape: str | None = Field(
        None, description="Shape from a recent /identify call, if any"
    )
    current_screen: str | None = Field(
        None,
        description=(
            "Which screen the user is on right now. The agent uses this to "
            "tailor suggestions and avoid redundant navigation tool calls "
            "(e.g. don't call open_cookbook if already on cookbook). "
            "Values are app-defined: 'home', 'cookbook', 'memory', "
            "'identify', 'recipe', 'cooking'."
        ),
    )
    current_step: CookingStep | None = Field(
        None, description="Cooking mode only: the step currently on screen"
    )
    active_timers: list[ActiveTimer] = Field(
        default_factory=list, description="Cooking mode only: running timers"
    )
    pantry_items: list[str] = Field(
        default_factory=list,
        description="Ingredients the user has on hand",
    )
    dietary_restrictions: list[StoredDietaryRestriction] = Field(
        default_factory=list,
        description="Hard filters the LLM must respect on all suggestions",
    )
    recent_cooking_history: list[str] = Field(
        default_factory=list,
        description="Recipe IDs cooked recently; used for taste-profile grounding",
    )
    user_observations: list[StoredObservation] = Field(
        default_factory=list,
        description=(
            "Recent observations from the memory log, capped at 20 by the app. "
            "Replaces the previous flat 'preferences' dict."
        ),
    )


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(
        default_factory=list,
        description="Prior turns in this conversation. App owns truncation.",
    )
    context: ChatContext = Field(default_factory=ChatContext)


class TraceCall(BaseModel):
    name: str
    arguments: dict
    status: Literal["ok", "error", "action"]  # ok = data tool run on the server
    error: str | None = None
    summary: str | None = None  # one line for the app: what the call did or found


class TraceStep(BaseModel):
    """One LLM call inside a turn."""
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    calls: list[TraceCall] = Field(default_factory=list)
    guard: str | None = None  # set when the backend sent this answer back or replaced it


class ChatResponse(BaseModel):
    """The turn output (and, from a client, one LLM call's output).

    `text` is what the user sees. `tool_calls` are the action tools for the
    app to dispatch; data tools already ran on the server and show up only in
    `trace`. Both may be present; either may be empty.
    """
    text: str
    tool_calls: list[ToolCall] = Field(default_factory=list)
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    trace: list[TraceStep] = Field(default_factory=list)
