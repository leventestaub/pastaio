"""Groq-backed vision client for Stage 1 identification.

Uses Qwen3.8 27B (multimodal) via Groq's OpenAI-compatible chat endpoint.
Single-purpose: identify a pasta shape from one image, return constrained JSON.

History: the original spike used Llama 4 Scout (75% top-1 on a 4-class,
20-image subset, same bucatini→spaghetti blind spot as Qwen3-VL). Groq has
since retired Scout; accuracy on the current model is measured in Phase 3.
"""
import base64
import json
import os
import time
from typing import Any

from groq import AsyncGroq, BadRequestError

from app.clients.base import VisionClient
from app.schemas.identify import IdentifyResponse, build_identify_prompt


DEFAULT_OPTIONS = {
    "temperature": 0.1,
    "top_p": 0.95,
    "max_tokens": 200,
}


class GroqVisionClient(VisionClient):
    """Talks to Groq's chat API with a multimodal model for vision identification."""

    def __init__(
        self,
        model: str = "qwen/qwen3.8-27b",
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

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": build_identify_prompt()},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ]
        start = time.monotonic()
        # json_object, not strict json_schema: under the schema Qwen3.8 sometimes
        # loops ('{"shapes":[{"confidence":[...') and Groq rejects the whole
        # generation. Vocabulary is enforced in from_model_json instead.
        for attempt in range(2):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    # Qwen3 thinking breaks JSON output; same setting as GroqClient.
                    reasoning_effort="none",
                    **self.options,
                )
                break
            except BadRequestError as e:
                if attempt == 1 or "json_validate_failed" not in str(e):
                    raise
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
        return IdentifyResponse.from_model_json(data, latency_ms)
