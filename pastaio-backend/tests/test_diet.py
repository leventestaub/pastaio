"""Dietary filtering, serving scaling and ingredient search in the agent's data tools."""
import asyncio
import json
import sqlite3

from app.schemas.chat import ChatContext, ChatRequest, StoredDietaryRestriction
from app.schemas.tools import DietaryRestriction, ToolName
from app.services import diet, kb
from app.services.chat_service import handle_chat
from tests.test_agent import Scripted, reply


def test_every_kb_ingredient_and_replacement_is_classified():
    conn = sqlite3.connect(kb.KB_DB_PATH)
    names = {i["name"] for (ings,) in conn.execute("SELECT ingredients FROM recipes") for i in json.loads(ings)}
    names |= {r for (r,) in conn.execute("SELECT replacement_ingredient FROM substitutions")}
    assert names - diet.INGREDIENT_CLASSES.keys() == set()


def test_conflicts():
    veg = [StoredDietaryRestriction(restriction=DietaryRestriction.VEGETARIAN)]
    gricia = kb.get_recipe_details("rigatoni-alla-gricia")["ingredients"]
    out = diet.conflicts(gricia, veg)
    assert [c["ingredient"] for c in out["conflicts"]] == ["guanciale"]
    assert [c["ingredient"] for c in out["caveats"]] == ["pecorino_romano_dop"]
    assert diet.conflicts([{"name": "made_up"}], veg)["conflicts"][0]["class"] == "unclassified"
    assert diet.conflicts(gricia, [StoredDietaryRestriction(restriction=DietaryRestriction.CUSTOM, custom_text="x")]) \
        == {"conflicts": [], "caveats": []}


def test_find_recipes_by_ingredient():
    ids = {r["recipe_id"] for r in kb.find_recipes(query="guanciale")}
    assert {"rigatoni-alla-gricia", "spaghetti-alla-carbonara", "bucatini-allamatriciana"} <= ids


def test_scaling():
    ings = kb.scale_ingredients(kb.get_recipe_details("spaghetti-alla-carbonara")["ingredients"], 4, 2)
    by = {i["name"]: i["amount"] for i in ings}
    assert by["spaghetti"] == 200 and by["tuorli_d_uovo"] == 2 and by["pepe_nero"] is None


def _run_with(restriction, *replies):
    """The tool result the model gets back for the scripted call."""
    client = Scripted(*replies)
    ctx = ChatContext(current_screen="home",
                      dietary_restrictions=[StoredDietaryRestriction(restriction=restriction)])
    import asyncio

    from app.schemas.chat import ChatRequest
    from app.services.chat_service import handle_chat
    asyncio.run(handle_chat(ChatRequest(message="hi", context=ctx), client))
    return json.loads(client.seen[1][-1].content)


def test_loop_filters_search_and_scales_details():
    found = _run_with(DietaryRestriction.VEGETARIAN, reply("", (ToolName.FIND_RECIPES, {"shape": "spaghetti"})))
    assert "spaghetti-alla-carbonara" in {e["recipe_id"] for e in found["excluded"]}
    assert "spaghetti-cacio-e-pepe" in {r["recipe_id"] for r in found["recipes"]}
    details = _run_with(DietaryRestriction.NO_PORK, reply(
        "", (ToolName.GET_RECIPE_DETAILS, {"recipe_id": "spaghetti-alla-carbonara", "servings": 8})))["recipe"]
    assert details["serves"] == 8 and details["dietary_check"]["conflicts"][0]["ingredient"] == "guanciale"
