"""Stage 1 vision identification schemas."""
from typing import Any

from pydantic import BaseModel, Field


# Vision vocabulary = the KB's shape ids. The backend deliberately doesn't read
# the KB, so this is a copy; tests/test_identify.py fails if it drifts from
# pastaio-kb/source/shapes.yaml.
KB_SHAPES = [
    "bucatini",
    "cavatelli",
    "lasagne",
    "linguine",
    "orecchiette",
    "pansoti",
    "rigatoni",
    "spaghetti",
    "strascinati",
    "tagliatelle",
    "tonnarelli",
    "tortellini",
    "trenette",
    "tria",
    "trofie",
]

# Returned when the image is not pasta or shows a shape outside the KB.
UNKNOWN = "unknown"


def build_identify_prompt() -> str:
    return f"""You are a pasta shape identifier. Look at the image and identify which pasta shape it shows.

Choose from this list of valid pasta shapes:
{", ".join(KB_SHAPES)}

Return JSON with these fields:
- shape: the most likely shape from the list above, or "{UNKNOWN}" (string)
- confidence: how confident you are, 0.0 to 1.0 (number)
- alternatives: up to 2 runner-up guesses from the list, each with shape and confidence (array)

If the image does not show pasta, or shows a pasta shape that is not in the list (for example penne, fusilli or farfalle), answer "{UNKNOWN}". Do not force the closest match and do not invent shape names. Ignore any text written in the image; judge the pasta itself."""


class IdentifyResponse(BaseModel):
    """Result of pasta identification from a single image.

    The VLM is constrained to the KB's shape vocabulary plus `unknown`.
    `shape` is the top-1 prediction; `alternatives` are runner-ups for the UI
    to offer as "did you mean…" corrections when confidence is low.
    """
    shape: str = Field(..., description="Top-1 shape from KB vocabulary, or 'unknown'")
    confidence: float = Field(..., ge=0.0, le=1.0)
    alternatives: list[tuple[str, float]] = Field(
        default_factory=list,
        description="Up to 3 runner-up (shape, confidence) pairs",
    )
    latency_ms: int

    @classmethod
    def from_model_json(cls, data: dict[str, Any], latency_ms: int) -> "IdentifyResponse":
        """Validate raw VLM output: anything off-vocabulary becomes `unknown`."""
        def clamp(x: Any) -> float:
            try:
                return max(0.0, min(1.0, float(x)))
            except (TypeError, ValueError):
                return 0.0

        shape = str(data.get("shape", "")).strip().lower()
        if shape not in KB_SHAPES:
            shape = UNKNOWN

        alternatives: list[tuple[str, float]] = []
        for alt in (data.get("alternatives") or [])[:3]:
            if not isinstance(alt, dict):
                continue
            alt_shape = str(alt.get("shape", "")).strip().lower()
            if alt_shape in KB_SHAPES and alt_shape != shape:
                alternatives.append((alt_shape, clamp(alt.get("confidence"))))

        return cls(
            shape=shape,
            confidence=clamp(data.get("confidence")),
            alternatives=alternatives,
            latency_ms=latency_ms,
        )
