"""Server-side KB: queries, ID resolution, and the committed DB being current."""
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.services import kb

KB_SRC = Path(__file__).resolve().parents[2] / "pastaio-kb"


def test_queries():
    assert {r["recipe_id"] for r in kb.find_recipes(shape_id="spaghetti")} >= {"spaghetti-alla-carbonara"}
    assert kb.find_recipes(query="PESTO")
    # words, not the whole phrase; best match first
    assert kb.find_recipes(query="amatriciana disciplinare")[0]["recipe_id"] == "bucatini-allamatriciana"
    assert not kb.find_recipes(query="sushi")
    assert kb.get_recipe_details("rigatoni-alla-gricia")["ingredients"]
    assert kb.get_recipe_details("nope") is None
    assert kb.get_substitution_options("basil", "trenette-al-pesto") == []  # KB has no rules yet


def test_resolve_recipe_id():
    assert kb.resolve_recipe_id("rigatoni-alla-gricia") == "rigatoni-alla-gricia"
    assert kb.resolve_recipe_id("trofie-pesto-genovese") == "trofie-al-pesto"
    assert kb.resolve_recipe_id("spaghetti-something") is None  # ambiguous
    for bad in ("active_recipe_id", "", None, "DROP TABLE"):
        assert kb.resolve_recipe_id(bad) is None


def test_committed_db_matches_yaml_sources(tmp_path):
    pytest.importorskip("yaml")
    if not KB_SRC.exists():
        pytest.skip("pastaio-kb sources not available")
    fresh = tmp_path / "kb.db"
    subprocess.run([sys.executable, str(KB_SRC / "build.py"), "--output", str(fresh)], check=True, capture_output=True)

    def dump(path):
        conn = sqlite3.connect(path)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name != 'kb_version'")]
        return {t: sorted(conn.execute(f"SELECT * FROM {t}").fetchall(), key=repr) for t in tables}

    assert dump(fresh) == dump(kb.KB_DB_PATH), (
        "app/kb/pastaio-kb.db is stale: python pastaio-kb/build.py --output pastaio-backend/app/kb/pastaio-kb.db"
    )


def test_recipe_details_carry_pairing_and_sources():
    trofie = kb.get_recipe_details("trofie-al-pesto")
    assert trofie["pairing"]["listed_as_traditional"] is True and trofie["pairing"]["shape_description"]
    assert trofie["sources"] and all(s["url"].startswith("http") for s in trofie["sources"])
    assert [s["tier"] for s in trofie["sources"]] == sorted(s["tier"] for s in trofie["sources"])
    assert kb.get_recipe_details("orecchiette-cime-di-rapa")["pairing"]["listed_as_traditional"] is False
