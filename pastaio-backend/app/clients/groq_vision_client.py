"""Groq-backed vision client for Stage 1 identification.

Uses Llama 4 Scout via Groq's OpenAI-compatible chat endpoint. Single-
purpose: identify a pasta shape from one image, return constrained JSON.

Justified by spike: Llama 4 Scout achieves ≥75% top-1 on KB shapes,
matching Qwen3-VL on distinctive shapes and showing the same systematic
blind spots (bucatini→spaghetti). The swap is for free-tier cloud
deployment, not for accuracy gains.
"""
import base64
import json
import os
import time
from typing import Any

from groq import AsyncGroq

from app.clients.base import VisionClient
from app.schemas.identify import IdentifyResponse


# Constrained vocabulary. Mirrors KB shapes — keep in sync when KB grows.
KB_SHAPES = [
    "spaghetti",
    "bucatini",
    "rigatoni",
    "tonnarelli",
    "linguine",
    "tagliatelle",
    "tortellini",
    "lasagne",
    "trofie",
    "trenette",
    "pansoti",
]


DEFAULT_OPTIONS = {
    "temperature": 0.1,
    "top_p": 0.95,
    "max_tokens": 200,
}


# Strict JSON schema. Groq strict mode requires `additionalProperties: false`
# on EVERY object level, not just the root — that's why this looks
# verbose. Without it on the alternatives item, you get:
#   "additionalProperties:false must be set on every object"
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
                "additionalProperties": False,
            },
        },
    },
    "required": ["shape", "confidence", "alternatives"],
    "additionalProperties": False,
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


class GroqVisionClient(VisionClient):
    """Talks to Groq's chat API with Llama 4 Scout for vision identification."""

    def __init__(
        self,
        model: str = "meta-llama/llama-4-scout-17b-16e-instruct",
        api_key: str | None = None,
        options: dict[str, Any] | None = None,
    ):
        api_key = api_key or os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY env var not set. "
                "Get a free key at https://console.groq.com"
            )
        self.model = model
        self.client = AsyncGroq(api_key=api_key)
        self.options = {**DEFAULT_OPTIONS, **(options or {})}
        print(f"[GroqVisionClient] model={model} options={self.options}")

    async def identify(self, image_bytes: bytes) -> IdentifyResponse:
        encoded = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:image/jpeg;base64,{encoded}"

        start = time.monotonic()
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _build_prompt()},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "pasta_identification",
                    "schema": IDENTIFY_OUTPUT_SCHEMA,
                    "strict": True,
                },
            },
            **self.options,
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        return self._parse_response(response, latency_ms)

    @staticmethod
    def _parse_response(response: Any, latency_ms: int) -> IdentifyResponse:
        text = response.choices[0].message.content or ""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"VLM returned non-JSON: {text[:200]!r}"
            ) from e

        shape = str(data.get("shape", "")).strip()
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.0))))

        raw_alts = data.get("alternatives") or []
        alternatives: list[tuple[str, float]] = []
        for alt in raw_alts[:3]:
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