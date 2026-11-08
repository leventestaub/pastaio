# Pastaio Backend

FastAPI service exposing `/identify` (Stage 1 vision) and `/chat` (Stage 2 agentic reasoning).

## Run with stubs (no models required)

```bash
./scripts/run_dev.sh
```

Returns realistic dummy responses. Used for app development without burning local GPU.

## Run with Ollama (real Qwen2.5:3b)

```bash
ollama pull qwen2.5:3b           # one time, ~2GB
ollama serve                     # if not already running

PASTAIO_REASONING_BACKEND=ollama ./scripts/run_dev.sh
```

Optional env overrides:

- `PASTAIO_OLLAMA_HOST` — defaults to `http://localhost:11434`
- `PASTAIO_OLLAMA_LLM_MODEL` — defaults to `qwen2.5:3b`

Stage 1 vision still runs the stub. Real VLM lands in week 5 per milestones.

## Test

```bash
python -m pytest tests/ -v
```

Ollama integration tests skip automatically when Ollama isn't reachable.

## Structure

```
app/
  api/         # FastAPI routers (thin HTTP layer)
  schemas/     # Pydantic request/response models — tools.py is locked
  services/    # Orchestration: prompts.py, chat_service.py
  clients/     # base ABC + stubs + ollama_client
  tools/       # (placeholder) — populated when KB schema lands
```

## Architectural notes

**Tool dispatch is client-side.** The server returns `tool_calls` as structured data in the `/chat` response; the RN app executes them against local state. Tools that mutate state (`open_recipe`, `set_timer`, `apply_substitution`, etc.) cannot run server-side — the server has no app state.

**Server is stateless.** Conversation history, active recipe, pantry, dietary restrictions, and user observations are passed on every request via `ChatContext`. The app owns session state. Per the Spike 2 multi-turn finding, the app must resolve references ("save it" → `recipe_id=X`) before sending — `active_recipe_id` is the result of that resolution.

**Two model clients, one backend.** `VisionClient` and `ReasoningClient` are internal ABCs. Backend selection is env-driven via `app/clients/factory.py`. Add new backends (Modal, RunPod) without touching route code.

**Tool schema is locked.** Ten tools, defined in `app/schemas/tools.py`. Change requires bumping the prompt version in `app/services/prompts.py` and re-running eval.

## Next

1. Backend deployment to Modal/RunPod (week 3–4)
2. KB schema + curation (weeks 3–4)
3. Real Stage 1 VLM (Qwen2.5-VL-3B) in week 5
4. Eval harness for tool dispatch + Italian reasoning
