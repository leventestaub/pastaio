from fastapi import APIRouter, Depends

from app.clients.base import ReasoningClient
from app.clients.factory import get_reasoning_client
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import handle_chat
from app.services.dev_log import (
    log_request_start,
    log_response_returned,
    log_user_input,
    log_error,
    new_request_id,
)


router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    client: ReasoningClient = Depends(get_reasoning_client),
) -> ChatResponse:
    rid = new_request_id()
    log_request_start(rid, "POST /chat", f"history={len(request.history)}")
    log_user_input(rid, request.message, request.context)

    try:
        response = await handle_chat(request, client)
    except Exception as e:
        log_error(rid, "/chat", e)
        raise

    log_response_returned(
        rid,
        f"text={len(response.text)}ch tools={len(response.tool_calls)}",
    )
    return response