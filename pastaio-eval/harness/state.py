"""In-memory state that mirrors the app's Zustand stores for eval purposes.

The eval harness doesn't run the app. Instead, it carries a SimulatedState
that the dispatcher mutates in response to tool calls. ChatContext for each
turn is built from this state.

Keep field names aligned with the app's stores so the cognitive translation
cost is low when reading both.
"""

from __future__ import annotations

from typing import Any

from .schema import InitialState, ScreenName


def _match_restriction(stored: Any, candidate: str) -> bool:
    if isinstance(stored, str):
        return stored == candidate
    if isinstance(stored, dict):
        return (stored.get("restriction") or stored.get("name")) == candidate
    return False


class SimulatedState:
    def __init__(self, initial: InitialState):
        self.current_screen: str = initial.current_screen.value
        self.active_recipe_id: str | None = initial.active_recipe_id
        self.active_shape: str | None = initial.active_shape
        self.cookbook: list[str] = list(initial.cookbook)
        self.cooking_active: bool = initial.cooking_active
        self.cooking_recipe_id: str | None = initial.cooking_recipe_id
        self.cooking_step_index: int = initial.cooking_step_index
        self.dietary_restrictions: list[str] = list(initial.dietary_restrictions)
        self.pantry_items: list[str] = list(initial.pantry_items)
        self.user_observations: list[dict[str, str]] = list(initial.user_observations)
        self.recent_cooking_history: list[dict[str, Any]] = list(
            initial.recent_cooking_history
        )
        # recipe_id -> { original_ingredient: replacement }
        self.substitutions: dict[str, dict[str, str]] = {
            k: dict(v) for k, v in initial.substitutions.items()
        }
        # Active timer (only one at a time per cooking session).
        self.active_timer: dict[str, Any] | None = None

    # ---------- Snapshot for ChatContext + traces ----------

    def to_dict(self) -> dict[str, Any]:
        return {
            "current_screen": self.current_screen,
            "active_recipe_id": self.active_recipe_id,
            "active_shape": self.active_shape,
            "cookbook": list(self.cookbook),
            "cooking_active": self.cooking_active,
            "cooking_recipe_id": self.cooking_recipe_id,
            "cooking_step_index": self.cooking_step_index,
            "dietary_restrictions": list(self.dietary_restrictions),
            "pantry_items": list(self.pantry_items),
            "user_observations": list(self.user_observations),
            "recent_cooking_history": list(self.recent_cooking_history),
            "substitutions": {k: dict(v) for k, v in self.substitutions.items()},
            "active_timer": dict(self.active_timer) if self.active_timer else None,
        }

    # ---------- Dotted-path access for assertion evaluation ----------

    def get_path(self, path: str) -> Any:
        """Look up a dotted path against the state dict. Returns None if missing."""
        node: Any = self.to_dict()
        for part in path.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return None
        return node

    # ---------- Mutators (called by EvalDispatcher) ----------

    def open_recipe(self, recipe_id: str) -> None:
        self.active_recipe_id = recipe_id
        self.current_screen = ScreenName.recipe.value

    def open_cookbook(self) -> None:
        self.current_screen = ScreenName.cookbook.value

    def start_identification(self) -> None:
        self.current_screen = ScreenName.identify.value

    def start_cooking(self, recipe_id: str) -> None:
        self.cooking_active = True
        self.cooking_recipe_id = recipe_id
        self.cooking_step_index = 0
        self.current_screen = ScreenName.cooking.value
        self.active_recipe_id = recipe_id

    def end_cooking(self) -> None:
        self.cooking_active = False
        self.cooking_recipe_id = None
        self.cooking_step_index = 0
        self.active_timer = None

    def apply_substitution(
        self, recipe_id: str, original_ingredient: str, replacement: str
    ) -> None:
        if recipe_id not in self.substitutions:
            self.substitutions[recipe_id] = {}
        self.substitutions[recipe_id][original_ingredient] = replacement

    def save_to_cookbook(self, recipe_id: str) -> None:
        if recipe_id not in self.cookbook:
            self.cookbook.append(recipe_id)

    def rate_recipe(self, recipe_id: str, rating: int, note: str | None = None) -> None:
        # Mirror app behavior: rating attaches to most recent matching cook.
        for entry in self.recent_cooking_history:
            if entry.get("recipe_id") == recipe_id and "rating" not in entry:
                entry["rating"] = rating
                if note:
                    entry["note"] = note
                return
        # No matching unrated cook -> append a synthetic record (rare).
        # NOTE: open mirror question — verify the TS rateCooking path's
        # behavior when no prior cook entry exists. May silently succeed,
        # may no-op. Align if a reasoning case exercises this edge.
        self.recent_cooking_history.insert(
            0, {"recipe_id": recipe_id, "rating": rating, "note": note or ""}
        )

    def set_dietary_restriction(self, restriction: str | dict) -> None:
        """Tool dispatcher hands us whatever the LLM emitted -- usually a
        plain string for the restriction name. Normalize both forms.
        """
        if isinstance(restriction, dict):
            value = restriction.get("restriction") or restriction.get("name")
            if value and not any(_match_restriction(r, value) for r in self.dietary_restrictions):
                self.dietary_restrictions.append(restriction)
            return
        if not any(_match_restriction(r, restriction) for r in self.dietary_restrictions):
            self.dietary_restrictions.append(restriction)

    def note_user_observation(
        self, observation: str, category: str = "", context: str = ""
    ) -> None:
        self.user_observations.append(
            {
                "observation": observation,
                "category": category,
                "context": context,
            }
        )

    def set_timer(self, duration_minutes: int, label: str = "") -> None:
        self.active_timer = {"duration_minutes": duration_minutes, "label": label}