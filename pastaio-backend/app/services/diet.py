"""Dietary restrictions as hard filters over KB ingredients.

The classes live in the KB (pastaio-kb/source/ingredient_classes.yaml ->
ingredient_classes and restriction_classes tables); the build fails when a
recipe ingredient is unclassified. Unknown names (e.g. a model-proposed
replacement) count as conflicts: fail closed. Custom restrictions are free
text and stay with the model.
"""
from __future__ import annotations

from functools import lru_cache

from app.schemas.chat import StoredDietaryRestriction
from app.services import kb


@lru_cache(maxsize=1)
def _tables() -> tuple[dict[str, set[str]], dict[tuple[str, str], set[str]]]:
    with kb._connect() as conn:
        classes: dict[str, set[str]] = {}
        for name, cls in conn.execute("SELECT ingredient, class FROM ingredient_classes"):
            classes.setdefault(name, set()).update({cls} if cls else set())
        rules: dict[tuple[str, str], set[str]] = {}
        for restriction, cls, severity in conn.execute(
            "SELECT restriction, class, severity FROM restriction_classes"
        ):
            rules.setdefault((restriction, severity), set()).add(cls)
    return classes, rules


def conflicts(ingredients: list[dict], restrictions: list[StoredDietaryRestriction]) -> dict:
    """{"conflicts": [...], "caveats": [...]} for one recipe's ingredients.

    Each entry: {"restriction", "ingredient", "class"}.
    """
    classes, rules = _tables()
    out: dict[str, list[dict]] = {"conflicts": [], "caveats": []}
    for r in restrictions:
        for key, severity in (("conflicts", "exclude"), ("caveats", "caveat")):
            banned = rules.get((r.restriction.value, severity), set())
            if not banned:
                continue
            for ing in ingredients:
                known = classes.get(ing["name"])
                hit = (known & banned) if known is not None else ({"unclassified"} if key == "conflicts" else set())
                out[key] += [{"restriction": r.restriction.value, "ingredient": ing["name"], "class": c}
                             for c in sorted(hit)]
    return out
