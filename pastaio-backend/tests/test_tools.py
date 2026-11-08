"""Tests for tool schema validation."""
import pytest
from pydantic import ValidationError

from app.schemas.tools import (
    TOOL_ARG_MODELS,
    TOOL_DEFINITIONS,
    ToolCall,
    ToolName,
    validate_tool_call,
)


def test_all_tools_have_arg_models():
    """Every ToolName must map to an argument model."""
    for name in ToolName:
        assert name in TOOL_ARG_MODELS, f"{name} missing from TOOL_ARG_MODELS"


def test_all_tools_have_definitions():
    """Every ToolName must have a definition for the LLM."""
    defined = {d.name for d in TOOL_DEFINITIONS}
    for name in ToolName:
        assert name in defined, f"{name} missing from TOOL_DEFINITIONS"


def test_tool_definition_count_matches():
    """No duplicate or extra tool definitions."""
    assert len(TOOL_DEFINITIONS) == len(ToolName)


def test_validate_well_formed_substitution_call():
    call = ToolCall(
        name=ToolName.GET_SUBSTITUTION_OPTIONS,
        arguments={"missing_ingredient": "basil", "recipe_id": "x"},
    )
    args = validate_tool_call(call)
    assert args.missing_ingredient == "basil"


def test_validate_rejects_bad_rating():
    call = ToolCall(
        name=ToolName.RATE_RECIPE,
        arguments={"recipe_id": "x", "rating": 99},
    )
    with pytest.raises(ValidationError):
        validate_tool_call(call)


def test_validate_rejects_negative_timer():
    call = ToolCall(
        name=ToolName.SET_TIMER,
        arguments={"duration_minutes": -5},
    )
    with pytest.raises(ValidationError):
        validate_tool_call(call)


def test_dietary_restriction_enum_value():
    call = ToolCall(
        name=ToolName.SET_DIETARY_RESTRICTION,
        arguments={"restriction": "vegetarian"},
    )
    args = validate_tool_call(call)
    assert args.restriction.value == "vegetarian"


def test_observation_requires_category():
    call = ToolCall(
        name=ToolName.NOTE_USER_OBSERVATION,
        arguments={"observation": "prefers parsley", "context": "test"},
    )
    with pytest.raises(ValidationError):
        validate_tool_call(call)
