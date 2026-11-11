"""Model-free checks for compare.py: cases are valid, scoring and Wilson work."""
import re
import sqlite3

from compare import KB_DB, METRICS, load_cases, score, wilson


def test_compare_cases_are_valid():
    cases = load_cases()
    known = {r for (r,) in sqlite3.connect(KB_DB).execute("SELECT recipe_id FROM recipes")}
    assert len({c["id"] for c in cases}) == len(cases)
    for c in cases:
        assert c["metric"] in METRICS + ["safety"], c["id"]
        assert c.get("include") or c.get("exclude") or c.get("tool"), c["id"]
        for p in c.get("include", []) + c.get("exclude", []):
            re.compile(p)
        ctx = c.get("context", {})
        assert {ctx.get("active_recipe_id"), c.get("args", {}).get("recipe_id")} - {None} <= known, c["id"]
        assert c["metric"] != "safety" or c.get("kind"), c["id"]


def test_score():
    case = {"include": ["600\\s*g"], "exclude": ["cream"]}
    assert score(case, "Use 600 g spaghetti.", [])
    assert not score(case, "Use 600 g spaghetti and cream.", [])
    assert not score(case, "Use 500 g.", [])
    tool = {"tool": "set_timer", "args": {"duration_minutes": 10}}
    assert score(tool, "", [{"name": "set_timer", "arguments": {"duration_minutes": 10}}])
    assert not score(tool, "", [{"name": "set_timer", "arguments": {"duration_minutes": 5}}])
    assert not score(tool, "Timer set!", [])


def test_wilson():
    lo, hi = wilson(10, 10)
    assert hi == 1.0 and 0.72 < lo < 0.73
    lo, hi = wilson(0, 10)
    assert lo == 0.0 and 0.27 < hi < 0.28
    assert wilson(0, 0) == (0.0, 0.0)


def test_abstain_detection():
    from compare import ABSTAIN
    assert ABSTAIN.search("The KB doesn't record the specific EU regulation.")
    assert ABSTAIN.search("I'm not finding that detail in the curated knowledge base.")
    assert not ABSTAIN.search("It was registered under Regulation 1169/2011.")
