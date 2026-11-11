"""CLI entrypoint for the eval harness.

Usage:
    python run_eval.py --backend http://localhost:8000 --repeats 3
    python run_eval.py --category dispatch
    python run_eval.py --case dispatch/find_recipes_basic.yaml
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import httpx

from harness.dispatcher import EvalDispatcher
from harness.report import build_report
from harness.runner import CaseRunner, load_case_from_yaml
from harness.schema import CaseResult, CaseTrace, EvalRunSummary


REPO_ROOT = Path(__file__).parent
CASES_DIR = REPO_ROOT / "cases"
RESULTS_DIR = REPO_ROOT / "results"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", default="http://localhost:8000")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument(
        "--category",
        choices=["dispatch", "coherence", "reasoning"],
        help="Run only this category. Default: all.",
    )
    parser.add_argument(
        "--case",
        help="Run a single case file (relative to cases/, or absolute).",
    )
    parser.add_argument(
        "--known-recipes",
        help="Path to a JSON file with a list of known recipe_ids. "
        "If omitted, fetches from {backend}/kb/recipes.",
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Smoke mode: run one case once, dump the trace JSON to stdout, "
        "skip writing to results/. Use with --case for fast integration debugging.",
    )
    parser.add_argument(
        "--dump-trace",
        action="store_true",
        help="Print each turn's dispatched tools and assertion results to stdout "
        "as the run progresses. Useful for diagnosing why a case fails.",
    )
    args = parser.parse_args()

    if args.smoke:
        args.repeats = 1
        if not args.case:
            print("--smoke requires --case", file=sys.stderr)
            return 2

    known_recipe_ids = _load_known_recipes(args.backend, args.known_recipes)
    dispatcher = EvalDispatcher(known_recipe_ids=known_recipe_ids)
    runner = CaseRunner(backend_url=args.backend, dispatcher=dispatcher)

    case_paths = _discover_cases(args.category, args.case)
    if not case_paths:
        print("No cases found.", file=sys.stderr)
        return 2

    # ---------- Smoke mode ----------
    if args.smoke:
        case = load_case_from_yaml(str(case_paths[0]))
        print(f"[smoke] running {case.case_id} ({len(case.turns)} turns)")
        trace = runner.run_case(case, repeat_index=0)
        print(trace.model_dump_json(indent=2))
        print(
            f"\n[smoke] case_passed={trace.case_passed}"
            + (f"  failure={trace.failure_reason}" if trace.failure_reason else "")
        )
        return 0 if trace.case_passed else 1

    started_at = datetime.utcnow()
    run_id = started_at.strftime("%Y-%m-%d_%H%M%S")
    run_dir = RESULTS_DIR / run_id
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)

    case_results: list[CaseResult] = []
    for path in case_paths:
        case = load_case_from_yaml(str(path))
        traces: list[CaseTrace] = []
        for i in range(args.repeats):
            print(f"[{case.case_id}] repeat {i + 1}/{args.repeats}...")
            trace = runner.run_case(case, repeat_index=i)
            traces.append(trace)
            _write_trace(run_dir, trace)
            if args.dump_trace:
                _print_trace_summary(trace)
        n_passed = sum(1 for t in traces if t.case_passed)
        rubric_pending = case.category == "reasoning" and any(
            t.asserts.rubric for t in case.turns
        )
        case_results.append(
            CaseResult(
                case_id=case.case_id,
                category=case.category,
                n_repeats=args.repeats,
                n_passed=n_passed,
                majority_passed=n_passed > args.repeats // 2,
                traces=traces,
                rubric_pending=rubric_pending,
            )
        )

    finished_at = datetime.utcnow()

    by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: {"passed": 0, "total": 0}
    )
    for cr in case_results:
        by_category[cr.category]["total"] += 1
        if cr.majority_passed:
            by_category[cr.category]["passed"] += 1

    summary = EvalRunSummary(
        run_id=run_id,
        started_at=started_at,
        finished_at=finished_at,
        backend_url=args.backend,
        model=os.environ.get("PASTAIO_GROQ_LLM_MODEL", "qwen/qwen3.8-27b"),
        prompt_version=os.environ.get("PROMPT_VERSION_OVERRIDE", "v10"),
        n_cases=len(case_results),
        n_passed_majority=sum(1 for cr in case_results if cr.majority_passed),
        by_category=dict(by_category),
        case_results=case_results,
    )

    report_md = build_report(summary)
    (run_dir / "report.md").write_text(report_md, encoding="utf-8")
    (run_dir / "summary.json").write_text(
        summary.model_dump_json(indent=2), encoding="utf-8"
    )
    print(f"\nReport: {run_dir / 'report.md'}")
    print(
        f"Pass: {summary.n_passed_majority}/{summary.n_cases} "
        f"({100 * summary.n_passed_majority // max(summary.n_cases, 1)}%)"
    )
    return 0 if summary.n_passed_majority == summary.n_cases else 1


def _discover_cases(category: str | None, single: str | None) -> list[Path]:
    if single:
        p = Path(single)
        if not p.is_absolute():
            p = CASES_DIR / single
        return [p]
    if category:
        return sorted((CASES_DIR / category).glob("*.yaml"))
    return sorted(CASES_DIR.glob("*/*.yaml"))


def _load_known_recipes(backend_url: str, override_path: str | None) -> list[str]:
    if override_path:
        with open(override_path, "r", encoding="utf-8") as f:
            return list(json.load(f))
    # Default: fetch from a debug endpoint on the backend. If the backend
    # doesn't expose one, fall back to a local snapshot if present.
    snapshot = REPO_ROOT / "known_recipes.json"
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{backend_url.rstrip('/')}/kb/recipes")
            r.raise_for_status()
            return list(r.json())
    except Exception:
        if snapshot.exists():
            print(f"[warn] using snapshot from {snapshot}")
            with open(snapshot, "r", encoding="utf-8") as f:
                return list(json.load(f))
        print(
            "[error] could not fetch known recipes from backend and no "
            "snapshot exists at known_recipes.json. Either expose "
            "GET /kb/recipes on the backend or commit a snapshot.",
            file=sys.stderr,
        )
        sys.exit(2)


def _write_trace(run_dir: Path, trace: CaseTrace) -> None:
    fname = f"{trace.case_id}__r{trace.repeat_index}.json"
    (run_dir / "traces" / fname).write_text(
        trace.model_dump_json(indent=2), encoding="utf-8"
    )


def _print_trace_summary(trace: CaseTrace) -> None:
    """Compact stdout summary for --dump-trace. One line per turn,
    plus assertion failures inlined.
    """
    status = "PASS" if trace.case_passed else "FAIL"
    print(f"  -> {status}", end="")
    if trace.failure_reason:
        print(f"  [{trace.failure_reason}]")
        return
    print()
    for i, tt in enumerate(trace.turn_traces):
        tools = ", ".join(
            f"{d.tool}{'!' if d.error else ''}{'~' if d.fuzzy_resolved else ''}"
            for d in tt.dispatched_tools
        ) or "(no tools)"
        turn_status = "ok" if tt.turn_passed else "FAIL"
        print(f"     turn {i + 1} [{turn_status}, {tt.latency_ms}ms]: {tools}")
        if not tt.turn_passed:
            for r in tt.assertion_results:
                if not r.passed:
                    print(f"       - {r.name}: {r.detail}")


if __name__ == "__main__":
    sys.exit(main())
