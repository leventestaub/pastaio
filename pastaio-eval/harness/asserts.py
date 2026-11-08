"""Assertion evaluation against a turn trace.

Each kind of assertion produces one or more AssertionResult records.
A turn passes iff every assertion result has passed=True.
"""

from __future__ import annotations

from typing import Any

from .schema import (
    AssertionResult,
    DispatchedTool,
    ToolCallAssertion,
    TurnAssertions,
)
from .state import SimulatedState


def evaluate_turn(
    asserts: TurnAssertions,
    dispatched: list[DispatchedTool],
    state_after: SimulatedState,
) -> list[AssertionResult]:
    results: list[AssertionResult] = []

    # ---------- expect_no_tools ----------
    if asserts.expect_no_tools:
        results.append(
            AssertionResult(
                name="expect_no_tools",
                passed=len(dispatched) == 0,
                detail=(
                    "no tools dispatched"
                    if len(dispatched) == 0
                    else f"got {len(dispatched)}: {[d.tool for d in dispatched]}"
                ),
            )
        )

    # ---------- expect_tool_calls ----------
    if asserts.expect_tool_calls:
        results.extend(
            _eval_tool_calls(
                asserts.expect_tool_calls,
                dispatched,
                expect_order=asserts.expect_order,
                forbid_extra=asserts.forbid_extra_tools,
            )
        )

    # ---------- expect_state ----------
    for path, expected in asserts.expect_state.items():
        actual = state_after.get_path(path)
        passed = actual == expected
        results.append(
            AssertionResult(
                name=f"state.{path}",
                passed=passed,
                detail=f"expected {expected!r}, got {actual!r}",
            )
        )

    return results


def _eval_tool_calls(
    expected: list[ToolCallAssertion],
    dispatched: list[DispatchedTool],
    expect_order: bool,
    forbid_extra: bool,
) -> list[AssertionResult]:
    results: list[AssertionResult] = []

    if expect_order:
        # Position-by-position match.
        for i, exp in enumerate(expected):
            if i >= len(dispatched):
                results.append(
                    AssertionResult(
                        name=f"tool[{i}]={exp.tool}",
                        passed=False,
                        detail="dispatched fewer tools than expected",
                    )
                )
                continue
            actual = dispatched[i]
            results.append(_match_tool(i, exp, actual))
    else:
        # Each expected must appear somewhere; track consumed indices.
        consumed: set[int] = set()
        for i, exp in enumerate(expected):
            match_idx = _find_unconsumed_match(exp, dispatched, consumed)
            if match_idx is None:
                results.append(
                    AssertionResult(
                        name=f"tool_unordered[{i}]={exp.tool}",
                        passed=False,
                        detail=f"no unconsumed dispatched call matched {exp.tool}",
                    )
                )
            else:
                consumed.add(match_idx)
                results.append(
                    AssertionResult(
                        name=f"tool_unordered[{i}]={exp.tool}",
                        passed=True,
                        detail=f"matched dispatched[{match_idx}]",
                    )
                )

    if forbid_extra:
        if len(dispatched) > len(expected):
            extras = [d.tool for d in dispatched[len(expected) :]]
            results.append(
                AssertionResult(
                    name="forbid_extra_tools",
                    passed=False,
                    detail=f"extra dispatched tools: {extras}",
                )
            )
        else:
            results.append(
                AssertionResult(name="forbid_extra_tools", passed=True, detail="")
            )

    return results


def _match_tool(
    i: int, expected: ToolCallAssertion, actual: DispatchedTool
) -> AssertionResult:
    name = f"tool[{i}]={expected.tool}"
    if actual.tool != expected.tool:
        return AssertionResult(
            name=name,
            passed=False,
            detail=f"expected tool {expected.tool}, got {actual.tool}",
        )
    if actual.error:
        return AssertionResult(
            name=name,
            passed=False,
            detail=f"dispatch error: {actual.error}",
        )
    if expected.args_match == "any":
        return AssertionResult(name=name, passed=True, detail="")
    return _match_args(name, expected, actual.args)


def _match_args(
    name: str, expected: ToolCallAssertion, actual_args: dict[str, Any]
) -> AssertionResult:
    if expected.args_match == "exact":
        if actual_args == expected.expected_args:
            return AssertionResult(name=name, passed=True, detail="")
        return AssertionResult(
            name=name,
            passed=False,
            detail=f"args exact: expected {expected.expected_args}, got {actual_args}",
        )
    # subset
    for k, v in expected.expected_args.items():
        if k not in actual_args:
            return AssertionResult(
                name=name,
                passed=False,
                detail=f"arg '{k}' missing in dispatched args",
            )
        if actual_args[k] != v:
            return AssertionResult(
                name=name,
                passed=False,
                detail=f"arg '{k}': expected {v!r}, got {actual_args[k]!r}",
            )
    return AssertionResult(name=name, passed=True, detail="")


def _find_unconsumed_match(
    expected: ToolCallAssertion,
    dispatched: list[DispatchedTool],
    consumed: set[int],
) -> int | None:
    for i, d in enumerate(dispatched):
        if i in consumed:
            continue
        if d.tool != expected.tool or d.error:
            continue
        if expected.args_match == "any":
            return i
        # Reuse subset/exact matching by inlining.
        if expected.args_match == "exact":
            if d.args == expected.expected_args:
                return i
            continue
        # subset
        if all(d.args.get(k) == v for k, v in expected.expected_args.items()):
            return i
    return None
