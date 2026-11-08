"""Data models for eval cases, turns, assertions, and traces.

A Case is a multi-turn conversation script. Each Turn describes one user
input plus the assertions that should hold after the model responds.
A Trace records what actually happened. A CaseResult aggregates assertion
outcomes across N repeats of the same case.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------- Case definition (loaded from YAML) ----------


class ScreenName(str, Enum):
    home = "home"
    discover = "discover"
    cookbook = "cookbook"
    memory = "memory"
    identify = "identify"
    recipe = "recipe"
    shape = "shape"
    search = "search"
    cooking = "cooking"


class InitialState(BaseModel):
    """Mutable state that exists before turn 1. Mirrors app stores.

    Authoring conventions (kept loose so YAML cases are pleasant to write):
    - dietary_restrictions: list[str] of restriction names, or list[dict]
      with keys `restriction` (and optional `custom_text`). build_chat_context
      lifts both to the wire shape.
    - user_observations: list[dict] with keys `observation`, `category`,
      and `context`. Missing `context` defaults to "" on the wire.
    - recent_cooking_history: list[str] of recipe IDs, or list[dict] with
      a `recipe_id` key (the dict form is useful when a turn needs to
      assert that a rating was attached).
    """

    current_screen: ScreenName = ScreenName.home
    active_recipe_id: str | None = None
    active_shape: str | None = None
    cookbook: list[str] = Field(default_factory=list)
    cooking_active: bool = False
    cooking_recipe_id: str | None = None
    cooking_step_index: int = 0
    dietary_restrictions: list[Any] = Field(default_factory=list)
    pantry_items: list[str] = Field(default_factory=list)
    user_observations: list[dict[str, Any]] = Field(default_factory=list)
    recent_cooking_history: list[Any] = Field(default_factory=list)
    substitutions: dict[str, dict[str, str]] = Field(default_factory=dict)
    # ^ recipe_id -> { original_ingredient: replacement }


class ToolCallAssertion(BaseModel):
    """One expected tool call. args_match supports exact, subset, or absent."""

    tool: str
    args_match: Literal["exact", "subset", "any"] = "subset"
    expected_args: dict[str, Any] = Field(default_factory=dict)
    # If exact: dispatched args must equal expected_args.
    # If subset: every key in expected_args must appear with matching value;
    #            extra keys in dispatched args are allowed.
    # If any:    only the tool name is checked, args ignored.


class TurnAssertions(BaseModel):
    """What should be true after the turn completes."""

    # Tool dispatch assertions.
    expect_tool_calls: list[ToolCallAssertion] = Field(default_factory=list)
    # Order matters; if you don't care about order, set expect_order=False.
    expect_order: bool = True
    # If true, no tools beyond expect_tool_calls may be dispatched.
    forbid_extra_tools: bool = False
    # If true, the turn must dispatch zero tools (text-only ANSWER mode).
    expect_no_tools: bool = False

    # State assertions evaluated against state AFTER turn dispatch.
    expect_state: dict[str, Any] = Field(default_factory=dict)
    # Each key is a dotted path into the state object (e.g.
    # "cooking_active", "cookbook", "substitutions.trofie-al-pesto.basil").
    # Value is the expected value (exact match).

    # Free-text rubric for human grading (reasoning cases).
    rubric: str | None = None


class Turn(BaseModel):
    user_input: str
    # Optional override of state before this turn (e.g. simulating a screen
    # transition that the previous turn's tools didn't cause).
    state_override: dict[str, Any] | None = None
    asserts: TurnAssertions = Field(default_factory=TurnAssertions)


class Case(BaseModel):
    case_id: str
    category: Literal["dispatch", "coherence", "reasoning"]
    description: str
    initial_state: InitialState = Field(default_factory=InitialState)
    turns: list[Turn]
    tags: list[str] = Field(default_factory=list)


# ---------- Trace (per run) ----------


class DispatchedTool(BaseModel):
    tool: str
    args: dict[str, Any]
    fuzzy_resolved: bool = False
    # ^ True if a recipe_id arg was rewritten by fuzzy resolution.
    original_args: dict[str, Any] | None = None
    # ^ Set when fuzzy_resolved=True so we can see what the model emitted.
    error: str | None = None


class TurnTrace(BaseModel):
    user_input: str
    chat_context_snapshot: dict[str, Any]
    raw_assistant_messages: list[dict[str, Any]]
    # ^ The full sequence the backend returned (assistant text + tool_use).
    dispatched_tools: list[DispatchedTool]
    state_before: dict[str, Any]
    state_after: dict[str, Any]
    assertion_results: list[AssertionResult] = Field(default_factory=list)
    turn_passed: bool = False
    latency_ms: int = 0


class AssertionResult(BaseModel):
    name: str
    passed: bool
    detail: str = ""


class CaseTrace(BaseModel):
    case_id: str
    category: str
    repeat_index: int
    started_at: datetime
    finished_at: datetime
    turn_traces: list[TurnTrace]
    case_passed: bool
    failure_reason: str | None = None


class CaseResult(BaseModel):
    """Aggregated outcome across N repeats of one case."""

    case_id: str
    category: str
    n_repeats: int
    n_passed: int
    majority_passed: bool
    traces: list[CaseTrace]
    rubric_pending: bool = False
    # ^ True if the case has a rubric assertion that needs hand-grading.


class EvalRunSummary(BaseModel):
    run_id: str
    started_at: datetime
    finished_at: datetime
    backend_url: str
    model: str
    prompt_version: str
    n_cases: int
    n_passed_majority: int
    by_category: dict[str, dict[str, int]]
    case_results: list[CaseResult]


# Late binding for forward ref in TurnTrace.assertion_results
TurnTrace.model_rebuild()
