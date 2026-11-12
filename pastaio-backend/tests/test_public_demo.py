"""Public-demo guards: rate limit, CORS, image size cap."""
from fastapi.testclient import TestClient

from app.api.identify import MAX_IMAGE_BYTES
from app.main import _hits, app

client = TestClient(app)
ORIGIN = {"Origin": "http://localhost:8081"}


def test_rate_limit_returns_429_with_cors():
    _hits.clear()
    codes = [
        client.post("/identify", files={"image": ("p.jpg", b"x", "image/jpeg")}, headers=ORIGIN).status_code
        for _ in range(6)
    ]
    assert codes[:5] == [200] * 5 and codes[5] == 429
    r = client.post("/identify", files={"image": ("p.jpg", b"x", "image/jpeg")}, headers=ORIGIN)
    assert r.headers["access-control-allow-origin"] == "http://localhost:8081"
    _hits.clear()


def test_unknown_origin_gets_no_cors_header():
    r = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_oversized_image_rejected():
    _hits.clear()
    r = client.post("/identify", files={"image": ("p.jpg", b"x" * (MAX_IMAGE_BYTES + 1), "image/jpeg")})
    assert r.status_code == 413
    _hits.clear()


def test_dev_log_off_prints_nothing(monkeypatch, capsys):
    import importlib

    from app.services import dev_log

    monkeypatch.setenv("PASTAIO_DEV_LOG", "0")
    quiet = importlib.reload(dev_log)
    quiet.log_user_input("ab12", "my private question")
    assert capsys.readouterr().out == ""
    monkeypatch.delenv("PASTAIO_DEV_LOG")
    importlib.reload(dev_log)


def test_groq_quota_error_is_503_with_cors():
    import httpx
    from groq import RateLimitError

    @app.get("/_boom")
    async def boom():
        resp = httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com"))
        raise RateLimitError("quota", response=resp, body=None)

    r = client.get("/_boom", headers=ORIGIN)
    assert r.status_code == 503 and "busy" in r.json()["detail"]
    assert r.headers["access-control-allow-origin"] == "http://localhost:8081"
