"""Build ChatContext payloads for the backend from SimulatedState.

Mirrors `pastaio-app/src/services/buildChatContext.ts` and matches the
backend's `app/schemas/chat.py:ChatContext`.

Shape gotchas that are easy to get wrong:
- dietary_restrictions is list[StoredDietaryRestriction], not list[str].
  Each entry: {restriction: <enum>, custom_text: str | None}.
- user_observations is list[StoredObservation], not list[dict].
  Each entry: {observation: str, category: <enum>, context: str}.
- recent_cooking_history is list[str] (recipe IDs), not list[dict].

Cases author the simulated state in friendly forms (plain strings for
restrictions, dicts for observations); this function lifts them into
the wire shape.
"""

from __future__ import annotations

from typing import Any

from .state import SimulatedState


def build_chat_context(state: SimulatedState) -> dict[str, Any]:
    return {
        "active_recipe_id": state.active_recipe_id,
        "active_shape": state.active_shape,
        "current_screen": state.current_screen,
        "pantry_items": list(state.pantry_items),
        "dietary_restrictions": _restrictions(state.dietary_restrictions),
        "recent_cooking_history": _cooking_history_ids(state.recent_cooking_history),
        "user_observations": _observations(state.user_observations),
    }


def _restrictions(items: list[Any]) -> list[dict[str, Any]]:
    """Accept either list[str] or list[dict] in the case YAML; emit the
    StoredDietaryRestriction shape on the wire.
    """
    out: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, str):
            out.append({"restriction": item, "custom_text": None})
        elif isinstance(item, dict):
            out.append(
                {
                    "restriction": item.get("restriction") or item.get("name"),
                    "custom_text": item.get("custom_text"),
                }
            )
    return out


def _observations(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Defensive: backend requires observation+category+context. Default
    missing context to empty string; let backend reject if category enum
    is wrong (better than the harness silently mangling enums).
    """
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "observation": item.get("observation", ""),
                "category": item.get("category", "other"),
                "context": item.get("context", ""),
            }
        )
    return out


def _cooking_history_ids(items: list[Any]) -> list[str]:
    """Accept list[str] (recipe IDs) directly, or list[dict] from richer
    case YAML and project to the id field. Backend expects list[str].
    """
    out: list[str] = []
    for item in items:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict) and item.get("recipe_id"):
            out.append(item["recipe_id"])
    return out
