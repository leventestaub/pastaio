"""Markdown report generation from a list of CaseResults."""

from __future__ import annotations

from collections import defaultdict

from .schema import CaseResult, CaseTrace, EvalRunSummary


def build_report(summary: EvalRunSummary) -> str:
    lines: list[str] = []
    lines.append(f"# Pastaio eval — {summary.run_id}")
    lines.append("")
    lines.append(f"- Started: {summary.started_at.isoformat()}")
    lines.append(f"- Finished: {summary.finished_at.isoformat()}")
    lines.append(f"- Backend: `{summary.backend_url}`")
    lines.append(f"- Model: `{summary.model}`")
    lines.append(f"- Prompt version: `{summary.prompt_version}`")
    lines.append(f"- Cases: {summary.n_cases}")
    lines.append(
        f"- Passed (majority of {3} repeats): "
        f"{summary.n_passed_majority} / {summary.n_cases} "
        f"({_pct(summary.n_passed_majority, summary.n_cases)}%)"
    )
    lines.append("")
    lines.append("## By category")
    lines.append("")
    lines.append("| Category | Pass | Total | % |")
    lines.append("|---|---|---|---|")
    for cat, stats in sorted(summary.by_category.items()):
        lines.append(
            f"| {cat} | {stats['passed']} | {stats['total']} | "
            f"{_pct(stats['passed'], stats['total'])}% |"
        )
    lines.append("")

    # Per-category case detail.
    by_cat: dict[str, list[CaseResult]] = defaultdict(list)
    for cr in summary.case_results:
        by_cat[cr.category].append(cr)

    for cat in sorted(by_cat.keys()):
        lines.append(f"## {cat}")
        lines.append("")
        for cr in by_cat[cat]:
            lines.append(_format_case_result(cr))
        lines.append("")

    return "\n".join(lines)


def _format_case_result(cr: CaseResult) -> str:
    status = "PASS" if cr.majority_passed else "FAIL"
    out: list[str] = []
    out.append(
        f"### {cr.case_id} — {status} ({cr.n_passed}/{cr.n_repeats})"
    )
    out.append("")
    if cr.rubric_pending:
        out.append("> _Rubric assertion pending hand-grading._")
        out.append("")
    if not cr.majority_passed:
        # Pull the first failing trace as a representative.
        rep = next((t for t in cr.traces if not t.case_passed), cr.traces[0])
        out.append(_format_trace(rep))
    return "\n".join(out)


def _format_trace(t: CaseTrace) -> str:
    out: list[str] = []
    if t.failure_reason:
        out.append(f"**Run-level failure:** {t.failure_reason}")
        out.append("")
    for i, tt in enumerate(t.turn_traces):
        passed = "ok" if tt.turn_passed else "FAIL"
        out.append(f"**Turn {i+1}** [{passed}, {tt.latency_ms}ms]: `{tt.user_input}`")
        if tt.dispatched_tools:
            out.append("")
            out.append("Dispatched:")
            for d in tt.dispatched_tools:
                fuzzy = " (fuzzy)" if d.fuzzy_resolved else ""
                err = f" ERROR: {d.error}" if d.error else ""
                out.append(f"- `{d.tool}({d.args})`{fuzzy}{err}")
        if not tt.turn_passed:
            out.append("")
            out.append("Failures:")
            for r in tt.assertion_results:
                if not r.passed:
                    out.append(f"- `{r.name}`: {r.detail}")
        out.append("")
    return "\n".join(out)


def _pct(num: int, denom: int) -> int:
    if denom == 0:
        return 0
    return round(100.0 * num / denom)
