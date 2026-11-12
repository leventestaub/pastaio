# Pastaio Eval Harness

Multi-turn evaluation harness for the agentic loop. Runs scripted
conversations against the live Groq-backed `/chat` endpoint, dispatches
tool calls into a simulated app state, and scores against per-turn
assertions.

## What it measures

Three case categories, each in its own folder under `cases/`:

- `dispatch/` — short conversations (often single-turn) with structural
  assertions only. "Did the model call the right tool with the right
  args?" Maps to spec targets: tool-call format compliance ≥ 95%, tool
  dispatch correctness ≥ 90%.
- `coherence/` — 3–5 turn conversations with ambiguous references
  ("save it", "set a timer for that"). Tests app-side reference
  resolution + dispatcher fuzzy matching + the system prompt working together.
  Maps to spec target: 5-turn dialogues maintain context in ≥ 90%.
- `reasoning/` — Italian-cooking judgment cases. Structural assertion
  plus a free-text rubric for hand-grading. Maps to spec target:
  Italian-specific reasoning correctly applied in ≥ 80%.

## Running

```bash
# Model-free tests of the harness itself (these run in CI).
uv run --with pytest pytest -q tests

# All cases, 3 repeats each, against the local backend.
uv run python run_eval.py --backend http://localhost:8000

# Only one category.
uv run python run_eval.py --category dispatch

# Single case (for iteration).
uv run python run_eval.py --case dispatch/find_recipes_by_shape.yaml --repeats 1
```

The harness needs to know which recipe IDs exist in the KB so the
fuzzy resolver can do its job. It fetches them from the backend's
`GET /kb/recipes`, so the eval stays in sync as the KB grows.

## Guarantee checks (`compare.py`)

`compare.py` runs the 31 single-turn cases in `compare_cases.yaml`
twice: once through `/chat`, and once against the same model with a
one-line prompt and no tools or KB. Cases cover numeric facts and
sources, scaling, dietary restrictions, safety (allergens, prompt
injection, off-topic requests, food safety) and actions. Each case
asserts regexes on the answer or an action the app must receive. Expected values come from the KB sources,
so a miss means the answer disagrees with the sourced KB.

Rates come with 95% Wilson intervals. Answers append to
`docs/results/compare-<model>.jsonl`, so a run interrupted by the Groq
free tier resumes where it stopped:

```bash
uv run --env-file ../.env python compare.py --backend http://localhost:8000
uv run python compare.py --report-only
```

These are regression checks for the guarantees in the main README, not
a leaderboard.

## Authoring cases

Cases are YAML, validated against `harness/schema.py`. Pattern:

```yaml
case_id: <category>__<short_description>
category: dispatch | coherence | reasoning
description: prose explaining what this tests and why

initial_state:
  current_screen: home
  active_recipe_id: null
  # ... see InitialState in schema.py for all fields

turns:
  - user_input: "what the user types"
    asserts:
      expect_tool_calls:
        - tool: find_recipes
          args_match: subset    # exact | subset | any
          expected_args:
            shape: trofie
      expect_order: true
      forbid_extra_tools: true
      expect_state:
        cookbook: [trofie-al-pesto]
      rubric: |
        Free-text criteria for hand-grading (reasoning cases).
```

Each case runs N times (default 3) and the case passes if a strict
majority of repeats passed. The trace from each run is written to
`results/<run_id>/traces/`.

## Hand-graded rubric assertions

Rubric assertions don't auto-pass or auto-fail. The harness flags them
as `rubric_pending` in the report. You read the assistant text in the
trace and mark pass/fail manually. This is the honest grading path for
"is this substitution culturally defensible" — there's no automatic
test for that.

## What the harness does NOT test

- Vision identification (the `/identify` endpoint). Separate eval, not
  in scope here.
- UI rendering. The harness simulates state, not screens.
- Network failures, retries, timeouts. The harness assumes the backend
  is up and reachable.

## Files

```
harness/
  schema.py        Pydantic models (Case, Turn, assertions, traces, results)
  state.py         SimulatedState — in-memory mirror of app stores
  context.py       build_chat_context(state) -> backend payload
  dispatcher.py    EvalDispatcher — mirrors toolDispatcher.ts (incl. fuzzy resolve)
  asserts.py       Assertion evaluators
  runner.py        CaseRunner — multi-turn execution against the backend
  report.py        Markdown report generation
cases/             YAML case files, organized by category
run_eval.py        CLI entrypoint
results/           Run outputs (gitignored)
```

## Mirror discipline

`harness/dispatcher.py` mirrors `pastaio-app/src/services/toolDispatcher.ts`
and must be updated when the TS dispatcher changes. Same for
`harness/state.py` vs the Zustand stores, and `harness/context.py` vs
`buildChatContext.ts`. There's no automatic sync — the duplication is
the cost of being able to run the eval without booting Expo.
