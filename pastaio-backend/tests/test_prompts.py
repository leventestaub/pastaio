"""Tests for system prompt assembly.

Focused on the failures that would silently degrade model behavior:
- A ChatContext field added but not wired into the prompt
- HARD/SOFT distinctions lost in rendering
- Empty fields rendering as confusing empty values instead of being omitted
"""
from app.schemas.chat import (
    ChatContext,
    StoredDietaryRestriction,
    StoredObservation,
)
from app.schemas.tools import DietaryRestriction, ObservationCategory
from app.services.prompts import build_system_prompt, render_context_block


def test_empty_context_renders_explicitly():
    """An empty context should not render as ambiguous whitespace."""
    prompt = build_system_prompt(ChatContext())
    assert "(empty)" in prompt


def test_active_recipe_renders():
    ctx = ChatContext(active_recipe_id="orecchiette-pugliese-01")
    block = render_context_block(ctx)
    assert "active_recipe_id: orecchiette-pugliese-01" in block


def test_dietary_restrictions_marked_hard():
    """The HARD label is load-bearing for rule 15. Don't drop it."""
    ctx = ChatContext(
        dietary_restrictions=[
            StoredDietaryRestriction(restriction=DietaryRestriction.VEGETARIAN)
        ]
    )
    block = render_context_block(ctx)
    assert "HARD" in block
    assert "vegetarian" in block


def test_custom_dietary_restriction_uses_custom_text():
    ctx = ChatContext(
        dietary_restrictions=[
            StoredDietaryRestriction(
                restriction=DietaryRestriction.CUSTOM,
                custom_text="no nightshades",
            )
        ]
    )
    block = render_context_block(ctx)
    assert "no nightshades" in block
    # The enum value 'custom' should not leak into the rendered text
    assert "custom" not in block.lower().split("(hard):")[1]


def test_observations_marked_soft():
    """The SOFT label is load-bearing for rule 16."""
    ctx = ChatContext(
        user_observations=[
            StoredObservation(
                observation="prefers parsley over basil",
                category=ObservationCategory.FOOD,
                context="orecchiette session",
            )
        ]
    )
    block = render_context_block(ctx)
    assert "SOFT" in block
    assert "parsley" in block
    assert "[food]" in block


def test_recent_history_capped_at_five():
    """Prevent long histories from pushing rules out of attention."""
    ctx = ChatContext(
        recent_cooking_history=[f"recipe-{i}" for i in range(10)]
    )
    block = render_context_block(ctx)
    assert "recipe-0" in block
    assert "recipe-4" in block
    assert "recipe-5" not in block


def test_unset_fields_omitted():
    """Unset fields should not produce empty lines or 'None' values."""
    ctx = ChatContext(active_recipe_id="x")
    block = render_context_block(ctx)
    assert "active_shape" not in block
    assert "pantry_items" not in block
    assert "None" not in block


def test_full_prompt_contains_load_bearing_rules():
    """Spot-check that the rules we depend on are actually in the prompt."""
    prompt = build_system_prompt(ChatContext())
    # The differentiation rule lives in the recipe-screen overlay
    assert "get_substitution_options" in build_system_prompt(
        ChatContext(current_screen="recipe")
    )
    # The over-logging rule
    assert "Do NOT log obvious" in prompt
    # The reference resolution rule
    assert "active_recipe_id" in prompt
    # The Spike 1 announce rule
    assert "Do not announce" in prompt


def test_cooking_step_and_timers_render():
    ctx = ChatContext(
        current_screen="cooking",
        current_step={"number": 3, "total": 7, "text": " Toss the pasta. "},
        active_timers=[{"label": "pasta", "remaining_seconds": 245}, {"remaining_seconds": 5}],
    )
    block = render_context_block(ctx)
    assert "current_step: 3 of 7: Toss the pasta." in block
    assert "active_timers: pasta (4m05s left), timer (0m05s left)" in block
    assert "current_step" in build_system_prompt(ctx)
