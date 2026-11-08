"""Internal model client abstraction.

This is backend-internal: it lets us swap Ollama (dev) for a Modal/RunPod
endpoint (prod) behind a single interface. It is NOT the app-facing
ModelClient from the spec — that one lives in the RN app and chooses
between hitting this backend vs on-device inference in v2.
"""
from abc import ABC, abstractmethod

from app.schemas.chat import ChatMessage, ChatResponse
from app.schemas.identify import IdentifyResponse


class VisionClient(ABC):
    @abstractmethod
    async def identify(self, image_bytes: bytes) -> IdentifyResponse: ...


class ReasoningClient(ABC):
    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str,
        tool_definitions: list[dict],
    ) -> ChatResponse: ...
