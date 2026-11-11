"""Model-free checks on the eval cases (run in CI): every case parses and
every recipe ID it mentions exists in the KB the backend ships."""
import sqlite3
from pathlib import Path

import pytest

from harness.runner import load_case_from_yaml

ROOT = Path(__file__).resolve().parents[1]
KB_DB = ROOT.parent / "pastaio-backend" / "app" / "kb" / "pastaio-kb.db"
CASES = sorted((ROOT / "cases").glob("*/*.yaml"))


def _recipe_ids(case) -> set[str]:
    s = case.initial_state
    ids = {s.active_recipe_id, s.cooking_recipe_id, *s.cookbook, *s.substitutions}
    ids |= {h if isinstance(h, str) else h.get("recipe_id") for h in s.recent_cooking_history}
    for turn in case.turns:
        ids |= {c.expected_args.get("recipe_id") for c in turn.asserts.expect_tool_calls}
        ids |= {(turn.state_override or {}).get("active_recipe_id")}
    return ids - {None}


@pytest.mark.parametrize("path", CASES, ids=[f"{p.parent.name}/{p.name}" for p in CASES])
def test_case_parses_and_uses_real_recipe_ids(path):
    case = load_case_from_yaml(str(path))
    known = {r for (r,) in sqlite3.connect(KB_DB).execute("SELECT recipe_id FROM recipes")}
    assert _recipe_ids(case) <= known


def test_there_are_cases():
    assert len(CASES) >= 30
