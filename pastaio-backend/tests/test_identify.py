"""Vision vocabulary and output validation."""
import re
from pathlib import Path

from app.schemas.identify import KB_SHAPES, UNKNOWN, IdentifyResponse

SHAPES_YAML = Path(__file__).parents[2] / "pastaio-kb" / "source" / "shapes.yaml"


def test_vocabulary_matches_kb():
    kb_ids = re.findall(r"^- shape_id: (\S+)", SHAPES_YAML.read_text(encoding="utf-8"), re.M)
    assert sorted(kb_ids) == sorted(KB_SHAPES)


def test_off_vocabulary_shape_becomes_unknown():
    r = IdentifyResponse.from_model_json(
        {"shape": "Penne", "confidence": 1.4, "alternatives": [
            {"shape": "rigatoni", "confidence": 0.2},
            {"shape": "fusilli", "confidence": 0.1},
            "junk",
        ]},
        latency_ms=1,
    )
    assert r.shape == UNKNOWN
    assert r.confidence == 1.0
    assert r.alternatives == [("rigatoni", 0.2)]


def test_known_shape_is_normalised():
    r = IdentifyResponse.from_model_json({"shape": " Bucatini ", "confidence": "0.7"}, latency_ms=1)
    assert (r.shape, r.confidence, r.alternatives) == ("bucatini", 0.7, [])
