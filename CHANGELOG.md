# Changelog

## Unreleased
- The chat sheet shows the question above the answer, and under it how Pastaio answered: one line per tool call and the guard that fired, if any.
- The public web demo is offline; the free-tier quota made it unreliable. The README shows recorded exchanges instead.
- Substitutions are gone from the home card and suggestion chips until the KB has sourced rules.
- Bolognese method reworded and credited as adapted from the Accademia's 2023 recipe.

## v2.0 (2026-11-12)
The agent moved to the server, the guarantees moved into code, and the app went live.

**Agent**
- The agent loop runs on the backend: one `/chat` request per turn, at most 4 model calls, data tools against the KB on the server, action tools returned to the app.
- Every tool call is validated against its schema, with one repair attempt. Near-miss recipe IDs are resolved against the KB.
- Factual answers require a lookup. An answer that says the KB lacks something without a lookup is sent back once.
- The turn always ends in text: the last step and the retry after an empty answer get no tools.
- Cooking mode is step-aware (current step and running timers are in the context).

**Knowledge base**
- The KB ships with the backend as SQLite, built from the YAML sources. CI fails if the committed database is stale.
- Dietary classes live in the KB and are shared by server and app. Restrictions filter searches, block substitutions that break them and flag conflicting recipes, and they fail closed for unknown ingredients.
- The data tools gained serving scaling, ingredient search, and pairing explanations from the KB.

**Models**
- Chat and vision on `qwen/qwen3.8-27b` after Groq retired Llama 4 Scout and qwen3-32b.
- Fallback chain to `gpt-oss-120b` and `gpt-oss-20b` on rate limits or rejected tool calls, with one wait for short per-minute limits.
- Vision is constrained to the KB's shape vocabulary plus `unknown`, with validated output.

**Deployment**
- Web app on GitHub Pages (desktop phone frame, link-preview tags), backend on Vercel.
- Public-demo hardening: CORS allow-list, per-IP rate limit, upload size cap, clean 503 on quota errors, dev logging off in production.
- CI: ruff and pytest for the backend, harness tests for the eval, typecheck, lint and Jest for the app.

**Evaluation and docs**
- `pastaio-eval/compare.py`: 31 single-turn guarantee checks with Wilson intervals and a safety slice.
- README rewritten around the guarantees and their tests. `docs/ARCHITECTURE.md` added. Walkthrough GIF and screenshots recorded against the real backend.

## v1.0 (2026-11-08)
Expo app with KB browsing, cooking mode, cookbook and memory; FastAPI backend for `/identify` and `/chat` with the agent loop in the app; 35-case multi-turn eval harness.
