"""Stub clients returning realistic dummy responses.

Replaced by OllamaClient / ModalClient once the real integration lands.
Dummy data is chosen to exercise the full response shape (alternatives,
tool_calls, etc.) so the mobile app can develop against realistic payloads.
"""
from app.clients.base import ReasoningClient, VisionClient
from app.schemas.chat import ChatMessage, ChatResponse
from app.schemas.identify import IdentifyResponse
from app.schemas.tools import ToolCall, ToolName


class StubVisionClient(VisionClient):
    async def identify(self, image_bytes: bytes) -> IdentifyResponse:
        return IdentifyResponse(
            shape="orecchiette",
            confidence=0.82,
            alternatives=[("conchiglie", 0.09), ("cavatelli", 0.05)],
            latency_ms=420,
        )


class StubReasoningClient(ReasoningClient):
    async def chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        tool_definitions: list[dict],
    ) -> ChatResponse:
        # Dummy reply exercises both text and a tool call so the app can
        # develop against a response with non-empty tool_calls.
        return ChatResponse(
            text=(
                "Spinach works but changes the dish — basil's anise notes are "
                "central. Try parsley for a closer flavor profile, or use "
                "spinach if you want a milder, earthier result."
            ),
            tool_calls=[
                ToolCall(
                    name=ToolName.APPLY_SUBSTITUTION,
                    arguments={
                        "recipe_id": "trenette-al-pesto",
                        "original": "basil",
                        "replacement": "parsley",
                    },
                )
            ],
            latency_ms=1340,
        )
