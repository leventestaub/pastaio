"""Stage 1 vision identification schemas."""
from pydantic import BaseModel, Field


class IdentifyResponse(BaseModel):
    """Result of pasta identification from a single image.

    The VLM is constrained to the KB's ~40 shape vocabulary. `shape` is the
    top-1 prediction; `alternatives` are runner-ups for the UI to offer as
    "did you mean…" corrections when confidence is low.
    """
    shape: str = Field(..., description="Top-1 identified pasta shape, from KB vocabulary")
    confidence: float = Field(..., ge=0.0, le=1.0)
    alternatives: list[tuple[str, float]] = Field(
        default_factory=list,
        description="Up to 3 runner-up (shape, confidence) pairs",
    )
    latency_ms: int
