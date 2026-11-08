"""Chat orchestration.

Keeps HTTP layer dumb. Real logic lands here:
- system prompt assembly via app.services.prompts
- tool definition filtering via app.services.tool_filter (new — cuts
  tokens-per-call by ~50% on most screens, critical for staying inside
  Groq's 6K TPM free-tier cap)
- (future) response validation via validate_tool_call before returning
"""
from app.clients.base import ReasoningClient
from app.schemas.chat import ChatMessage, ChatRequest, ChatResponse
from app.services.prompts import build_system_prompt
from app.services.tool_filter import tools_for_context


async def handle_chat(request: ChatRequest, client: ReasoningClient) -> ChatResponse:
    system_prompt = build_system_prompt(request.context)
    messages = [
        *request.history,
        ChatMessage(role="user", content=request.message),
    ]
    tool_definitions = tools_for_context(request.context)
    return await client.chat(messages, system_prompt, tool_definitions)