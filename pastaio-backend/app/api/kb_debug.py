"""Debug routes for the eval harness. Not part of the user-facing API.

Exposes the KB recipe-ID list so external evaluators can populate fuzzy
resolvers without needing a snapshot file. Read-only; no state changes.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/kb", tags=["debug"])


from app.services.kb import KB_DB_PATH


@router.get("/recipes", response_model=list[str])
def list_recipe_ids() -> list[str]:
    """Return all recipe_ids in the bundled KB.

    The eval harness uses this to populate its fuzzy-resolution candidate
    set. The list is small (target ~50 recipes) so we don't paginate.
    """
    if not KB_DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=f"KB not found at {KB_DB_PATH}. Run pastaio-kb/build.py.",
        )
    conn = sqlite3.connect(str(KB_DB_PATH))
    try:
        rows = conn.execute("SELECT recipe_id FROM recipes ORDER BY recipe_id").fetchall()
        return [row[0] for row in rows]
    finally:
        conn.close()