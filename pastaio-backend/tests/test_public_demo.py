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
