"""Plain LLM vs Pastaio on the same model (sprint Phase 2D).

plain   = the model alone: a one-line cooking-assistant prompt, the user's
          restrictions and the on-screen recipe title as text, no tools, no KB.
pastaio = the backend /chat (system prompt, KB data tools, app actions).

Each case in compare_cases.yaml runs N times per system and passes on a
majority of runs. Rates come with 95% Wilson intervals. Answers append to
docs/results/compare-<model>.jsonl, so an interrupted run (Groq free tier:
8k tokens/min plus a daily cap) resumes where it stopped; the markdown
report is rebuilt from that file.

  uv run --env-file ../.env python compare.py --backend http://localhost:8000
  uv run python compare.py --report-only

The model is PASTAIO_GROQ_LLM_MODEL (same variable the backend reads) and
PASTAIO_GROQ_REASONING_EFFORT; start the backend with the same values.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sqlite3
import time
from datetime import date
from pathlib import Path

import httpx
import yaml

from harness.runner import _tool_args, _tool_name

ROOT = Path(__file__).resolve().parent
KB_DB = ROOT.parent / "pastaio-backend" / "app" / "kb" / "pastaio-kb.db"
RESULTS = ROOT.parent / "docs" / "results"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
PLAIN_PROMPT = "You are a helpful Italian home-cooking assistant. Answer in the user's language."
# Same sampling as the backend's GroqClient.
SAMPLING = {"temperature": 0.3, "top_p": 0.9, "max_tokens": 2048}
METRICS = ["facts", "scaling", "restrictions", "actions"]
# A missed fact is "abstained" when the answer says it doesn't know, else "wrong".
ABSTAIN = re.compile(
    r"(doesn't|does not|don't|do not|couldn't|could not|can't|cannot) (have|record|find|know|contain|include)"
    r"|not (finding|sure|recorded|in the (curated )?(KB|knowledge base))|no (record|information)",
    re.I,
)


def load_cases(path: Path = ROOT / "compare_cases.yaml") -> list[dict]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def score(case: dict, text: str, tools: list[dict]) -> bool:
    # ponytail: regex scoring; answers are kept in the jsonl for hand checks.
    # An LLM judge would catch "no guanciale here" false positives.
    if any(not re.search(p, text, re.I) for p in case.get("include", [])):
        return False
    if any(re.search(p, text, re.I) for p in case.get("exclude", [])):
        return False
    if "tool" in case:
        want = case.get("args", {})
        return any(
            _tool_name(c) == case["tool"] and all(_tool_args(c).get(k) == v for k, v in want.items())
            for c in tools
        )
    return True


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - half), min(1.0, centre + half)


# ---------- systems ----------


def _post(client: httpx.Client, url: str, **kw) -> dict:
    """POST with waits on rate limits (Groq 429, backend 429/503)."""
    for attempt in range(20):
        r = client.post(url, **kw)
        if r.status_code not in (429, 503):
            r.raise_for_status()
            return r.json()
        wait = float(r.headers.get("retry-after") or 30)
        print(f"  rate limited ({r.status_code}), waiting {wait:.0f}s")
        time.sleep(min(wait, 120))
    raise SystemExit("Still rate limited (daily cap?). Rerun later; finished answers are kept.")


def _title(recipe_id: str) -> str:
    row = sqlite3.connect(KB_DB).execute("SELECT title FROM recipes WHERE recipe_id=?", (recipe_id,)).fetchone()
    return row[0] if row else recipe_id


def plain_prompt(ctx: dict) -> str:
    lines = [PLAIN_PROMPT]
    rs = [r.get("custom_text") or r["restriction"].replace("_", " ") for r in ctx.get("dietary_restrictions", [])]
    if rs:
        lines.append(f"The user's dietary restrictions: {', '.join(rs)}.")
    if ctx.get("active_recipe_id"):
        lines.append(f"The user is looking at the recipe: {_title(ctx['active_recipe_id'])}.")
    if ctx.get("current_step"):
        lines.append(f"The user is cooking, on step {ctx['current_step']['number']}.")
    return "\n".join(lines)


def ask_plain(client: httpx.Client, model: str, case: dict) -> tuple[str, list[dict], int]:
    effort = os.getenv("PASTAIO_GROQ_REASONING_EFFORT", "none")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": plain_prompt(case.get("context", {}))},
            {"role": "user", "content": case["question"]},
        ],
        "reasoning_effort": effort,
        **SAMPLING,
    }
    headers = {"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"}
    r = _post(client, GROQ_URL, json=body, headers=headers)
    return r["choices"][0]["message"].get("content") or "", [], r.get("usage", {}).get("total_tokens", 0)


def ask_pastaio(client: httpx.Client, backend: str, case: dict) -> tuple[str, list[dict], int]:
    body = {"message": case["question"], "history": [], "context": case.get("context", {})}
    r = _post(client, f"{backend}/chat", json=body)
    tokens = (r.get("prompt_tokens") or 0) + (r.get("completion_tokens") or 0)
    return r.get("text") or "", r.get("tool_calls") or [], tokens


# ---------- run + report ----------


def run(backend: str, model: str, repeats: int, only: str | None) -> Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"compare-{model.replace('/', '_')}.jsonl"
    done = {(r["system"], r["case"], r["repeat"]) for r in _rows(out)}
    with httpx.Client(timeout=120) as client, out.open("a", encoding="utf-8") as f:
        for case in load_cases():
            if only and not case["id"].startswith(only):
                continue
            systems = ["pastaio"] if "tool" in case else ["plain", "pastaio"]
            for i in range(repeats):
                for system in systems:
                    if (system, case["id"], i) in done:
                        continue
                    if system == "plain":
                        text, tools, tokens = ask_plain(client, model, case)
                    else:
                        text, tools, tokens = ask_pastaio(client, backend, case)
                    ok = score(case, text, tools)
                    print(f"{case['id']:45} {system:8} #{i} {'pass' if ok else 'FAIL'} {tokens} tok")
                    row = {"system": system, "case": case["id"], "repeat": i, "passed": ok,
                           "tokens": tokens, "text": text, "tools": tools}
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                    f.flush()
    return out


def _rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def report(path: Path, model: str, prompt_version: str) -> str:
    cases = {c["id"]: c for c in load_cases()}
    runs: dict[tuple[str, str], list[bool]] = {}
    for r in _rows(path):
        if r["case"] in cases:
            # Re-score so a changed regex applies to stored answers.
            runs.setdefault((r["system"], r["case"]), []).append(score(cases[r["case"]], r["text"], r["tools"]))
    majority = {key: sum(v) * 2 > len(v) for key, v in runs.items()}
    wrong: dict[tuple[str, str], list[bool]] = {}
    for r in _rows(path):
        if cases.get(r["case"], {}).get("metric") == "facts":
            missed = not score(cases[r["case"]], r["text"], r["tools"])
            wrong.setdefault((r["system"], r["case"]), []).append(missed and not ABSTAIN.search(r["text"]))
    n_runs = max((len(v) for v in runs.values()), default=0)

    def cell(system: str, ids: list[str], runs_by_case: dict | None = None) -> str:
        votes = majority if runs_by_case is None else {k: sum(v) * 2 > len(v) for k, v in runs_by_case.items()}
        got = [votes[(system, i)] for i in ids if (system, i) in votes]
        if not got:
            return "n/a"
        lo, hi = wilson(sum(got), len(got))
        return f"{sum(got)}/{len(got)} ({lo:.0%}–{hi:.0%})"

    lines = [
        f"# Plain LLM vs Pastaio ({model})",
        "",
        f"Run {date.today().isoformat()}, prompt {prompt_version}, {n_runs} runs per case and system. "
        "A case counts as passed when most of its runs pass. Cells: passed cases / cases (95% Wilson interval).",
        "",
        "| Metric | Plain LLM | Pastaio |",
        "|---|---|---|",
    ]
    for m in METRICS:
        ids = [i for i, c in cases.items() if c["metric"] == m]
        lines.append(f"| {m} | {cell('plain', ids)} | {cell('pastaio', ids)} |")
        if m == "facts":
            lines.append(f"| facts stated wrong (lower is better) | {cell('plain', ids, wrong)} "
                         f"| {cell('pastaio', ids, wrong)} |")

    lines += ["", "## Safety slice", "", "| Kind | Plain LLM | Pastaio |", "|---|---|---|"]
    safety = [i for i, c in cases.items() if c["metric"] == "safety"]
    for kind in dict.fromkeys(cases[i]["kind"] for i in safety):
        ids = [i for i in safety if cases[i]["kind"] == kind]
        lines.append(f"| {kind} | {cell('plain', ids)} | {cell('pastaio', ids)} |")
    lines.append(f"| all | {cell('plain', safety)} | {cell('pastaio', safety)} |")

    lines += ["", "## Per case (runs passed)", "", "| Case | Plain LLM | Pastaio |", "|---|---|---|"]
    for i in cases:
        p, q = runs.get(("plain", i)), runs.get(("pastaio", i))
        lines.append(f"| {i} | {f'{sum(p)}/{len(p)}' if p else 'n/a'} | {f'{sum(q)}/{len(q)}' if q else 'n/a'} |")

    lines += [
        "",
        "## Method",
        "",
        "- Same model and sampling for both systems. The plain LLM gets the restrictions and the "
        "on-screen recipe title as text but no tools and no KB; actions are Pastaio-only.",
        "- Expected facts and amounts come from the sourced KB. Scoring is regex-based "
        "(`pastaio-eval/compare_cases.yaml`); every answer is in the `.jsonl` next to this file for hand checks.",
        "- A missed fact counts as wrong unless the answer says it doesn't know (`ABSTAIN` in compare.py); "
        "saying so is the behaviour Pastaio's prompt asks for.",
        "- Known limit: an exclude pattern also fires when the answer names a banned ingredient "
        "to warn about it, which makes the restriction and safety rates conservative.",
    ]
    md = "\n".join(lines) + "\n"
    path.with_suffix(".md").write_text(md, encoding="utf-8")
    return md


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="http://localhost:8000")
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--case", help="only cases whose id starts with this")
    ap.add_argument("--prompt-version", default="v10")
    ap.add_argument("--report-only", action="store_true")
    a = ap.parse_args()
    model = os.getenv("PASTAIO_GROQ_LLM_MODEL", "qwen/qwen3.8-27b")
    path = RESULTS / f"compare-{model.replace('/', '_')}.jsonl"
    if not a.report_only:
        path = run(a.backend.rstrip("/"), model, a.repeats, a.case)
    print(report(path, model, a.prompt_version))


if __name__ == "__main__":
    main()
