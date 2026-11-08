"""Ollama-backed vision client for Stage 1 identification.

Wraps Ollama's /api/chat with image input for Qwen3-VL-4B. Single-purpose:
identify a pasta shape from one image, return constrained JSON.

Constrained vocabulary is enforced via the prompt — we list valid shape
IDs and ask for exactly one. The KB lives on-device per architecture, so
the backend doesn't read it; if the model returns a shape outside the
vocab, it gets passed through and the app can show "did you mean..."
fallback UI.

Confidence scores from VLMs are not calibrated probabilities. We ask the
model for a 0-1 estimate as a UX signal, not as a real likelihood.
README will be honest about this in the limitations section.
"""
import base64
import json
import time
from typing import Any

import ollama

from app.clients.base import VisionClient
from app.schemas.identify import IdentifyResponse


# Constrained vocabulary. Mirrors the shapes in pastaio-kb/source/shapes.yaml.
# Lives here (not in the KB) because the backend deliberately doesn't read
# the KB. When you add shapes, update this list manually.
#
# Order doesn't matter to the model; sorted alphabetically for review ease.
KB_SHAPES = [
    "bucatini",
    "orecchiette",
    "penne",
    "spaghetti",
    "trofie",
    # Add more as the KB grows toward the spec target of ~40 shapes.
]


# Sampling. Default Qwen3-VL recipe is temperature=1.0, top_p=0.95, top_k=20,
# but for a constrained classification task we want determinism, not
# variety. temperature=0.1 keeps responses stable across runs of the same
# image. top_p/top_k stay at defaults to avoid surprising the model.
DEFAULT_OPTIONS = {
    "temperature": 0.1,
    "top_p": 0.95,
    "top_k": 20,
    "num_ctx": 8192,
}


# JSON Schema for Ollama's structured output. The model is forced to emit
# JSON matching this shape, which eliminates a class of parsing bugs.
IDENTIFY_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "shape": {"type": "string"},
        "confidence": {"type": "number"},
        "alternatives": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "shape": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["shape", "confidence"],
            },
        },
    },
    "required": ["shape", "confidence", "alternatives"],
}


def _build_prompt() -> str:
    shapes_list = ", ".join(KB_SHAPES)
    return f"""You are a pasta shape identifier. Look at the image and identify which pasta shape it shows.

You MUST choose from this list of valid pasta shapes:
{shapes_list}

Return JSON with these fields:
- shape: the most likely shape from the list above (string)
- confidence: how confident you are, 0.0 to 1.0 (number)
- alternatives: up to 2 runner-up guesses, each with shape and confidence (array)

If the image does not show pasta, or shows a pasta shape not in the list, pick the closest visual match from the list and lower the confidence accordingly. Do not invent shape names."""


class OllamaVisionClient(VisionClient):
    """Talks to a local Ollama instance running qwen3-vl:4b."""

    def __init__(
        self,
        model: str = "qwen3-vl:4b",
        host: str = "http://localhost:11434",
        options: dict[str, Any] | None = None,
    ):
        self.model = model
        self.client = ollama.AsyncClient(host=host)
        self.options = {**DEFAULT_OPTIONS, **(options or {})}
        print(
            f"[OllamaVisionClient] model={model} host={host} "
            f"options={self.options}"
        )

    async def identify(self, image_bytes: bytes) -> IdentifyResponse:
        # Ollama accepts images as base64-encoded strings on the message.
        # No data: prefix, no MIME type — just the base64 payload.
        encoded = base64.b64encode(image_bytes).decode("ascii")

        start = time.monotonic()
        response = await self.client.chat(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": _build_prompt(),
                    "images": [encoded],
                }
            ],
            options=self.options,
            format=IDENTIFY_OUTPUT_SCHEMA,  # structured output: forced JSON
            think=False,  # see Stage 2 client; thinking degrades small models
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        return self._parse_response(response, latency_ms)

    @staticmethod
    def _parse_response(response: Any, latency_ms: int) -> IdentifyResponse:
        msg = (
            response.get("message", {})
            if isinstance(response, dict)
            else response.message
        )
        text = _get(msg, "content") or ""

        # With format=schema, content is a JSON string. Parse, with fallback
        # for the rare cases where Ollama returns content alongside other
        # fields. We don't accept failure silently — bad JSON is a bug to
        # surface, not absorb.
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"VLM returned non-JSON content: {text[:200]!r}"
            ) from e

        # Defensive coercion. The schema enforces presence + types but
        # bounds aren't part of JSON Schema's "type": "number".
        shape = str(data.get("shape", "")).strip()
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.0))))

        raw_alts = data.get("alternatives") or []
        alternatives: list[tuple[str, float]] = []
        for alt in raw_alts[:3]:  # cap at 3
            if not isinstance(alt, dict):
                continue
            alt_shape = str(alt.get("shape", "")).strip()
            alt_conf = max(0.0, min(1.0, float(alt.get("confidence", 0.0))))
            if alt_shape and alt_shape != shape:
                alternatives.append((alt_shape, alt_conf))

        return IdentifyResponse(
            shape=shape,
            confidence=confidence,
            alternatives=alternatives,
            latency_ms=latency_ms,
        )


def _get(obj: Any, key: str) -> Any:
    """Tolerate dict-or-attribute access. Same helper as ollama_client.py."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)
