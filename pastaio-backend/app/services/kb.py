"""Server-side KB queries for the agent's data tools.

Python port of the three lookups in pastaio-app/src/services/kb.ts
(findRecipes, getRecipeDetails, getSubstitutionOptions) plus recipe-ID
resolution. The database is a committed build of pastaio-kb/source
(`python pastaio-kb/build.py --output pastaio-backend/app/kb/pastaio-kb.db`);
tests/test_kb.py fails when it is stale.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

KB_DB_PATH = Path(__file__).resolve().parents[1] / "kb" / "pastaio-kb.db"

# Strings the model copies from the prompt instead of a real ID.
PLACEHOLDER_RECIPE_IDS = {
    "active_recipe_id", "current_recipe", "current_recipe_id",
    "recipe_id", "the_recipe", "this_recipe",
}


def _connect() -> sqlite3.Connection:
    # Read-only: the Vercel filesystem is read-only anyway.
    conn = sqlite3.connect(f"file:{KB_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def find_recipes(shape_id: str | None = None, query: str | None = None, limit: int = 10) -> list[dict]:
    """Recipes matching shape and/or query; the query hits title, description
    or an ingredient name ("guanciale", "pecorino", "basilico")."""
    sql = "SELECT recipe_id, title, region_id, cook_time_minutes, description, ingredients FROM recipes"
    with _connect() as conn:
        rows = conn.execute(sql + (" WHERE shape_id = ?" if shape_id else ""), [shape_id] if shape_id else []).fetchall()
    q = (query or "").strip().lower()
    out = []
    for r in rows:
        names = [i["name"] for i in json.loads(r["ingredients"])]
        haystack = [r["title"].lower(), r["description"].lower(), *(n.replace("_", " ") for n in names)]
        if q and not any(q in h for h in haystack):
            continue
        out.append({"recipe_id": r["recipe_id"], "title": r["title"], "region_id": r["region_id"],
                    "cook_time_minutes": r["cook_time_minutes"], "ingredient_names": names})
    return out[:limit]


def scale_ingredients(ingredients: list[dict], serves: int, servings: int) -> list[dict]:
    """Amounts scaled from `serves` to `servings`; "q.b." (to taste) stays unscaled."""
    factor = servings / serves
    scaled = []
    for ing in ingredients:
        amount = ing.get("amount")
        if amount is not None:
            amount *= factor
            # grams/ml to the nearest 5 above 50, counts to the nearest half
            amount = (round(amount / 5) * 5 if amount > 50 else round(amount)) if ing.get("unit") in ("g", "ml")                 else max(0.5, round(amount * 2) / 2)
        scaled.append({**ing, "amount": amount})
    return scaled


def get_recipe_details(recipe_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """SELECT recipe_id, title, shape_id, region_id, sauce_category_id,
                      description, cook_time_minutes, serves, ingredients, steps,
                      tags, traditional_notes, evidence_strength, confidence
               FROM recipes WHERE recipe_id = ?""",
            [recipe_id],
        ).fetchone()
    if row is None:
        return None
    recipe = dict(row)
    for key in ("ingredients", "steps", "tags"):
        recipe[key] = json.loads(recipe[key])
    return recipe


def get_substitution_options(missing_ingredient: str, recipe_id: str | None = None) -> list[dict]:
    """Most specific scope first: this recipe, its sauce category, universal."""
    with _connect() as conn:
        sauce = None
        if recipe_id:
            row = conn.execute(
                "SELECT sauce_category_id FROM recipes WHERE recipe_id = ?", [recipe_id]
            ).fetchone()
            sauce = row["sauce_category_id"] if row else None
        rows = conn.execute(
            """SELECT replacement_ingredient, reasoning, score,
                      applies_to_sauce_category, applies_to_recipe_id
               FROM substitutions
               WHERE LOWER(original_ingredient) = ?
                 AND (applies_to_recipe_id = ? OR applies_to_sauce_category = ?
                      OR (applies_to_recipe_id IS NULL AND applies_to_sauce_category IS NULL))
               ORDER BY CASE WHEN applies_to_recipe_id = ? THEN 0
                             WHEN applies_to_sauce_category = ? THEN 1 ELSE 2 END,
                        score DESC""",
            [missing_ingredient.strip().lower(), recipe_id, sauce, recipe_id, sauce],
        ).fetchall()
    return [
        {
            "replacement": r["replacement_ingredient"],
            "reasoning": r["reasoning"],
            "score": r["score"],
            "scope": "recipe" if r["applies_to_recipe_id"]
            else "sauce_category" if r["applies_to_sauce_category"] else "universal",
        }
        for r in rows
    ]


def resolve_recipe_id(candidate: object) -> str | None:
    """The real recipe ID for `candidate`, or None.

    Rejects placeholders and garbage, accepts exact IDs, then tries a
    conservative fuzzy match: >= 2 shared dash-tokens (3+ chars) with exactly
    one real ID. Catches hallucinations like "trofie-pesto-genovese".
    """
    if not isinstance(candidate, str):
        return None
    cid = candidate.strip().lower()
    if cid in PLACEHOLDER_RECIPE_IDS or not re.fullmatch(r"[a-z0-9-]{3,80}", cid):
        return None
    with _connect() as conn:
        ids = [r[0] for r in conn.execute("SELECT recipe_id FROM recipes")]
    if cid in ids:
        return cid
    tokens = {t for t in cid.split("-") if len(t) >= 3}
    matches = [i for i in ids if len(tokens & {t for t in i.split("-") if len(t) >= 3}) >= 2]
    return matches[0] if len(matches) == 1 else None
