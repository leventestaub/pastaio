"""Eval-side dispatcher.

Mirrors `pastaio-app/src/services/toolDispatcher.ts`. When the app changes,
this needs to change too. Both files reference each other in a header
comment so the duplication is at least visible.

Recipe ID handling has three layers, mirroring the TS dispatcher:
  1. is_plausible_recipe_id — cheap syntactic check; rejects placeholder
     strings ("active_recipe_id") and obvious garbage.
  2. resolve_recipe_id — runs the syntactic check, then tries the known-IDs
     set directly, then falls back to fuzzy resolution. Returns the
     resolved real ID or None.
  3. resolve_fuzzy_recipe_id — token-overlap match against real IDs
     (>=2 shared hyphen-tokens, exactly one match in the candidate set).

Note on RECIPE_ID_TOOLS: the TS dispatcher also routes
get_substitution_options.recipe_id through resolveRecipeId (as an optional
refinement scope). We deliberately omit it here because our read-tool
branch is a no-op — there's no state to mutate either way, and adding it
would require special-casing the failure path (TS falls back to universal
scope on bad ID; current _apply short-circuits to error). Documented
divergence, not silent.
"""

from __future__ import annotations

import re
from typing import Any

from .schema import DispatchedTool
from .state import SimulatedState


# Tools that require recipe_id arg and should run through fuzzy resolution.
RECIPE_ID_TOOLS = {
    "open_recipe",
    "get_recipe_details",
    "save_to_cookbook",
    "start_cooking",
    "rate_recipe",
}


# Placeholder strings the LLM sometimes emits literally instead of a real ID.
# Mirrors PLACEHOLDER_RECIPE_IDS in toolDispatcher.ts.
PLACEHOLDER_RECIPE_IDS = {
    "active_recipe_id",
    "current_recipe",
    "current_recipe_id",
    "recipe_id",
    "the_recipe",
    "this_recipe",
}

# Mirrors the regex in toolDispatcher.ts:isPlausibleRecipeId.
_RECIPE_ID_RE = re.compile(r"^[a-z0-9-]{3,80}$")


def is_plausible_recipe_id(candidate: Any) -> bool:
    """Cheap syntactic check. Rejects placeholders and obvious garbage."""
    if not isinstance(candidate, str):
        return False
    trimmed = candidate.strip()
    if not trimmed:
        return False
    if trimmed.lower() in PLACEHOLDER_RECIPE_IDS:
        return False
    return bool(_RECIPE_ID_RE.match(trimmed))


class EvalDispatcher:
    def __init__(self, known_recipe_ids: list[str]):
        self.known_recipe_ids = list(known_recipe_ids)

    # ---------- Fuzzy resolution (mirrors kb.ts:resolveFuzzyRecipeId) ----------
    #
    # Faithful port. Specifically:
    # - lowercase + trim before tokenizing
    # - split on '-' only (NOT underscore)
    # - drop tokens shorter than 3 chars
    # - return None only when the filtered token set is empty
    # - require >=2 shared tokens with a candidate, and exactly one match
    #
    # The hyphen-only split is intentional, and a known cause of real-world
    # misses (e.g. the LLM emitting `trofie_with_pesto`). Don't "improve"
    # this without changing kb.ts in lockstep -- the harness exists to
    # surface those failures, not paper over them.

    def resolve_fuzzy_recipe_id(self, candidate: str) -> tuple[str | None, bool]:
        """Returns (resolved_id, was_fuzzy_resolved).

        If candidate exists exactly, returns it with fuzzy=False.
        Else applies the same token-overlap rules as the TS resolver.
        Returns (None, False) on no match or ambiguous multi-match.
        """
        if candidate in self.known_recipe_ids:
            return candidate, False

        normalized = candidate.lower().strip()
        if not normalized:
            return None, False

        candidate_tokens = {
            t for t in normalized.split("-") if len(t) >= 3
        }
        if not candidate_tokens:
            return None, False

        matches: list[str] = []
        for known in self.known_recipe_ids:
            real_tokens = {
                t for t in known.lower().split("-") if len(t) >= 3
            }
            shared = len(candidate_tokens & real_tokens)
            if shared >= 2:
                matches.append(known)

        if len(matches) == 1:
            return matches[0], True
        return None, False

    def resolve_recipe_id(self, candidate: Any) -> tuple[str | None, bool]:
        """Three-layer recipe_id resolution.

        Mirrors toolDispatcher.ts:resolveRecipeId. Returns
        (resolved_id_or_None, was_fuzzy_resolved).

        - Plausibility check rejects placeholders and bad-format strings.
        - Direct known-IDs check returns exact matches.
        - Fuzzy match catches LLM hallucinations like
          'trofie-pesto-genovese' -> 'trofie-al-pesto'.
        """
        if not is_plausible_recipe_id(candidate):
            return None, False
        return self.resolve_fuzzy_recipe_id(candidate)

    # ---------- Dispatch ----------

    def dispatch(
        self, tool_name: str, args: dict[str, Any], state: SimulatedState
    ) -> DispatchedTool:
        original_args = dict(args)
        fuzzy_resolved = False

        # Recipe-ID resolution layer.
        if tool_name in RECIPE_ID_TOOLS and "recipe_id" in args:
            resolved, was_fuzzy = self.resolve_recipe_id(args["recipe_id"])
            if resolved is None:
                return DispatchedTool(
                    tool=tool_name,
                    args=args,
                    error=f"recipe_id '{args['recipe_id']}' not valid or not found",
                )
            args["recipe_id"] = resolved
            fuzzy_resolved = was_fuzzy

        # Apply to state.
        try:
            self._apply(tool_name, args, state)
        except Exception as e:
            return DispatchedTool(
                tool=tool_name,
                args=args,
                fuzzy_resolved=fuzzy_resolved,
                original_args=original_args if fuzzy_resolved else None,
                error=str(e),
            )

        return DispatchedTool(
            tool=tool_name,
            args=args,
            fuzzy_resolved=fuzzy_resolved,
            original_args=original_args if fuzzy_resolved else None,
        )

    def _apply(
        self, tool_name: str, args: dict[str, Any], state: SimulatedState
    ) -> None:
        # Read tools — no state mutation, but the trace records them.
        if tool_name in {"find_recipes", "get_recipe_details", "get_substitution_options"}:
            return

        # Navigation tools.
        if tool_name == "open_recipe":
            state.open_recipe(args["recipe_id"])
            return
        if tool_name == "open_cookbook":
            state.open_cookbook()
            return
        if tool_name == "start_identification":
            state.start_identification()
            return
        if tool_name == "start_cooking":
            state.start_cooking(args["recipe_id"])
            return
        if tool_name == "end_cooking":
            state.end_cooking()
            return

        # Write tools.
        if tool_name == "apply_substitution":
            recipe_id = args.get("recipe_id") or state.active_recipe_id
            if not recipe_id:
                raise ValueError("apply_substitution: no recipe_id in args or active")
            state.apply_substitution(
                recipe_id,
                args["original"],
                args["replacement"],
            )
            return
        if tool_name == "save_to_cookbook":
            state.save_to_cookbook(args["recipe_id"])
            return
        if tool_name == "rate_recipe":
            rating = args.get("rating")
            if rating not in (1, 2, 3, 4, 5):
                raise ValueError(f"rate_recipe: invalid rating {rating!r}")
            state.rate_recipe(
                args["recipe_id"],
                rating,
                args.get("note"),
            )
            return
        if tool_name == "set_dietary_restriction":
            state.set_dietary_restriction(args["restriction"])
            return
        if tool_name == "note_user_observation":
            state.note_user_observation(
                args["observation"],
                args.get("category", ""),
                args.get("context", ""),
            )
            return
        if tool_name == "set_timer":
            if not state.cooking_active:
                raise ValueError("set_timer: not in cooking mode")
            state.set_timer(args["duration_minutes"], args.get("label", ""))
            return

        raise ValueError(f"Unknown tool: {tool_name}")