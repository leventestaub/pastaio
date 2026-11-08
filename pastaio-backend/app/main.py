from fastapi import FastAPI

from app.api import chat, identify, kb_debug

app = FastAPI(title="Pastaio Backend", version="0.1.0")

app.include_router(identify.router)
app.include_router(chat.router)
app.include_router(kb_debug.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

@app.get("/ping")
async def ping():
    print("[ping] hit")
    return {"ok": True}
