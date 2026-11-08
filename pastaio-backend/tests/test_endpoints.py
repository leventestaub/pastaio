import io
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_identify_returns_expected_shape():
    fake_image = io.BytesIO(b"not really an image")
    r = client.post(
        "/identify",
        files={"image": ("pasta.jpg", fake_image, "image/jpeg")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["shape"] == "orecchiette"
    assert 0.0 <= body["confidence"] <= 1.0
    assert len(body["alternatives"]) >= 1


def test_chat_returns_text_and_tool_call():
    r = client.post(
        "/chat",
        json={
            "message": "I don't have basil, can I use spinach?",
            "history": [],
            "context": {"active_recipe_id": "orecchiette-pugliese-01"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["text"], str) and len(body["text"]) > 0
    assert len(body["tool_calls"]) == 1
    assert body["tool_calls"][0]["name"] == "apply_substitution"
