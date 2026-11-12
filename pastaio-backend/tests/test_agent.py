"""Agent loop (app.services.chat_service) with a scripted model."""
import asyncio
import json

from app.clients.base import ReasoningClient
from app.schemas.chat import ChatContext, ChatRequest, ChatResponse, StoredDietaryRestriction
from app.schemas.tools import ToolCall, ToolName
from app.services.chat_service import MAX_STEPS, handle_chat


class Scripted(ReasoningClient):
    """Replies in order; records the messages of every call."""

    def __init__(self, *replies: ChatResponse):
        self.replies, self.seen, self.tools = list(replies), [], []

    async def chat(self, messages, system_prompt, tool_definitions):
        self.seen.append(list(messages))
        self.tools.append(tool_definitions)
        return self.replies.pop(0) if self.replies else reply("done")


def reply(text="", *calls):
    return ChatResponse(text=text, tool_calls=[ToolCall(name=n, arguments=a) for n, a in calls],
                        latency_ms=10, prompt_tokens=100, completion_tokens=5)


def run(client, message="hi", screen="recipe", diet=()):
    ctx = ChatContext(current_screen=screen,
                      dietary_restrictions=[StoredDietaryRestriction(restriction=d) for d in diet])
    return asyncio.run(handle_chat(ChatRequest(message=message, context=ctx), client))


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


def test_second_invalid_call_is_not_returned_and_model_must_answer_in_text():
    bad = (ToolName.OPEN_RECIPE, {"recipe_id": "made-up-dish"})
    client = Scripted(reply("", bad), reply("", bad), reply("I couldn't find that dish."))
    out = run(client)
    assert out.tool_calls == [] and out.text == "I couldn't find that dish."
    assert client.tools[-1] == [] and len(out.trace) == 3


def test_step_limit():
    looping = [reply("", (ToolName.FIND_RECIPES, {"query": "pesto"})) for _ in range(MAX_STEPS + 2)]
    client = Scripted(*looping)
    out = run(client)
    assert len(out.trace) == MAX_STEPS
    assert client.tools[-1] == [] and all(client.tools[:-1])  # last call: text only


def test_all_matches_excluded_says_so():
    client = Scripted(reply("", (ToolName.FIND_RECIPES, {"query": "carbonara"})), reply("None fit."))
    run(client, diet=["vegan"])
    result = json.loads(client.seen[1][-1].content)
    assert result["recipes"] == [] and result["excluded"] and "note" in result


def test_search_results_point_to_details_for_facts():
    client = Scripted(reply("", (ToolName.FIND_RECIPES, {"query": "carbonara"})), reply("Found it."))
    run(client)
    assert "get_recipe_details" in json.loads(client.seen[1][-1].content)["note"]


def test_substitution_that_breaks_a_restriction_is_blocked():
    sub = (ToolName.APPLY_SUBSTITUTION,
           {"recipe_id": "spaghetti-alla-carbonara", "original": "guanciale", "replacement": "pancetta"})
    client = Scripted(reply("Swapped.", sub), reply("Pancetta is pork too; try mushrooms?"))
    out = run(client, diet=["vegetarian"])
    assert out.tool_calls == [] and "vegetarian" in client.seen[1][-1].content
    assert out.text.startswith("Pancetta")


def test_opening_a_conflicting_recipe_is_allowed_but_flagged():
    open_it = (ToolName.OPEN_RECIPE, {"recipe_id": "spaghetti-alla-carbonara"})
    client = Scripted(reply("Opening.", open_it), reply("Heads up: guanciale isn't vegetarian.", open_it))
    out = run(client, diet=["vegetarian"])
    assert [c.name for c in out.tool_calls] == [ToolName.OPEN_RECIPE]  # deduped
    assert "dietary_conflicts" in client.seen[1][-1].content and out.text.startswith("Heads up")


def test_abstaining_without_a_lookup_is_sent_back_once():
    client = Scripted(
        reply("The KB doesn't record that regulation."),
        reply("", (ToolName.GET_RECIPE_DETAILS, {"recipe_id": "bucatini-allamatriciana"})),
        reply("Regulation (EU) 2020/395."),
    )
    out = run(client, "Which regulation registered amatriciana?")
    assert out.text == "Regulation (EU) 2020/395."
    assert "looked anything up" in client.seen[1][-1].content


def test_abstaining_after_a_lookup_stands():
    client = Scripted(
        reply("", (ToolName.GET_RECIPE_DETAILS, {"recipe_id": "rigatoni-alla-gricia"})),
        reply("The KB doesn't record who invented it."),
    )
    assert run(client).text == "The KB doesn't record who invented it." and len(client.seen) == 2
