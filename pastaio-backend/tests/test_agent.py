"""Agent loop (app.services.chat_service) with a scripted model."""
import asyncio
import json

from app.clients.base import ReasoningClient
from app.schemas.chat import ChatContext, ChatRequest, ChatResponse
from app.schemas.tools import ToolCall, ToolName
from app.services.chat_service import MAX_STEPS, handle_chat


class Scripted(ReasoningClient):
    """Replies in order; records the messages of every call."""

    def __init__(self, *replies: ChatResponse):
        self.replies, self.seen = list(replies), []

    async def chat(self, messages, system_prompt, tool_definitions):
        self.seen.append(list(messages))
        return self.replies.pop(0) if self.replies else reply("done")


def reply(text="", *calls):
    return ChatResponse(text=text, tool_calls=[ToolCall(name=n, arguments=a) for n, a in calls],
                        latency_ms=10, prompt_tokens=100, completion_tokens=5)


def run(client, message="hi", screen="recipe"):
    return asyncio.run(handle_chat(ChatRequest(message=message, context=ChatContext(current_screen=screen)), client))


def test_data_tool_runs_on_server_and_result_goes_back_as_tool_message():
    client = Scripted(
        reply("", (ToolName.GET_RECIPE_DETAILS, {"recipe_id": "rigatoni-alla-gricia"})),
        reply("Gricia uses guanciale."),
    )
    out = run(client)
    assert out.text == "Gricia uses guanciale." and out.tool_calls == []
    assistant, tool = client.seen[1][-2:]
    assert assistant.role == "assistant" and assistant.tool_calls[0].id == tool.tool_call_id
    assert json.loads(tool.content)["recipe"]["title"]
    assert [c.status for s in out.trace for c in s.calls] == ["ok"]
    assert out.prompt_tokens == 200 and out.latency_ms == 20


def test_action_tool_is_returned_to_the_app_with_fuzzy_resolved_id():
    out = run(Scripted(reply("Opening it.", (ToolName.OPEN_RECIPE, {"recipe_id": "trofie-pesto-genovese"}))))
    assert [(c.name, c.arguments["recipe_id"]) for c in out.tool_calls] == [(ToolName.OPEN_RECIPE, "trofie-al-pesto")]
    assert len(out.trace) == 1  # actions alone end the turn


def test_invalid_call_gets_one_repair_attempt():
    client = Scripted(
        reply("", (ToolName.SET_TIMER, {"duration_minutes": -5})),
        reply("Timer set.", (ToolName.SET_TIMER, {"duration_minutes": 5})),
    )
    out = run(client, screen="cooking")
    assert "duration_minutes" in client.seen[1][-1].content  # error fed back
    assert out.tool_calls[0].arguments == {"duration_minutes": 5}
    assert [c.status for s in out.trace for c in s.calls] == ["error", "action"]


def test_second_invalid_call_is_not_retried_or_returned():
    bad = (ToolName.OPEN_RECIPE, {"recipe_id": "made-up-dish"})
    out = run(Scripted(reply("", bad), reply("", bad), reply("never reached")))
    assert out.tool_calls == [] and len(out.trace) == 2 and out.text  # fallback text


def test_step_limit():
    looping = [reply("", (ToolName.FIND_RECIPES, {"query": "pesto"})) for _ in range(MAX_STEPS + 2)]
    out = run(Scripted(*looping))
    assert len(out.trace) == MAX_STEPS
