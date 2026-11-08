"""Unit tests for OllamaClient.

Focused on the conversion layers — both directions:
- internal ToolDefinition → Ollama tool shape
- Ollama response → ChatResponse

Does NOT hit a real Ollama instance. Integration test lives separately
and requires PASTAIO_OLLAMA_LLM_MODEL pulled locally.
"""
from app.clients.ollama_client import OllamaClient, _simplify_schema, _to_ollama_tool
from app.schemas.tools import TOOL_DEFINITIONS


def test_tool_definition_converts_to_ollama_shape():
    """All locked tools must convert without losing fields."""
    for td in TOOL_DEFINITIONS:
        out = _to_ollama_tool(td.model_dump(mode="json"))
        assert out["type"] == "function"
        assert out["function"]["name"] == td.name.value
        assert isinstance(out["function"]["name"], str)
        assert out["function"]["description"] == td.description


def test_tool_name_is_string_not_enum_repr():
    """Regression: enums leaking as <ToolName.X: 'x'> breaks Qwen tool calls."""
    for td in TOOL_DEFINITIONS:
        out = _to_ollama_tool(td.model_dump(mode="json"))
        name = out["function"]["name"]
        assert not name.startswith("<"), f"Enum repr leaked: {name}"
        assert "ToolName" not in name


def test_simplify_schema_flattens_nullable_anyof():
    """anyOf: [T, null] should collapse to T — small models choke on anyOf."""
    schema = {
        "type": "object",
        "properties": {
            "dish_name": {
                "anyOf": [{"type": "string"}, {"type": "null"}],
                "default": None,
                "title": "Dish Name",
            },
        },
    }
    out = _simplify_schema(schema)
    assert out["properties"]["dish_name"]["type"] == "string"
    assert "anyOf" not in out["properties"]["dish_name"]
    assert "default" not in out["properties"]["dish_name"]
    assert "title" not in out["properties"]["dish_name"]


def test_simplify_schema_preserves_enum_constraints():
    """Enum restriction fields like DietaryRestriction must survive simplification."""
    schema = {
        "type": "object",
        "properties": {
            "restriction": {
                "type": "string",
                "enum": ["vegetarian", "vegan"],
            },
        },
    }
    out = _simplify_schema(schema)
    assert out["properties"]["restriction"]["enum"] == ["vegetarian", "vegan"]


def test_parse_response_with_text_only():
    response = {
        "message": {
            "content": "I'd suggest carbonara.",
            "tool_calls": [],
        }
    }
    result = OllamaClient._parse_response(response, latency_ms=1200)
    assert result.text == "I'd suggest carbonara."
    assert result.tool_calls == []
    assert result.latency_ms == 1200


def test_parse_response_with_tool_call():
    response = {
        "message": {
            "content": "",
            "tool_calls": [
                {
                    "function": {
                        "name": "find_recipes",
                        "arguments": {"shape": "orecchiette"},
                    }
                }
            ],
        }
    }
    result = OllamaClient._parse_response(response, latency_ms=900)
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name.value == "find_recipes"
    assert result.tool_calls[0].arguments == {"shape": "orecchiette"}


def test_parse_response_skips_unknown_tool_name():
    """An LLM hallucinating a tool name should not crash the response."""
    response = {
        "message": {
            "content": "Done",
            "tool_calls": [
                {"function": {"name": "make_coffee", "arguments": {}}}
            ],
        }
    }
    result = OllamaClient._parse_response(response, latency_ms=500)
    assert result.tool_calls == []
    assert result.text == "Done"


def test_parse_response_handles_missing_message_fields():
    response = {"message": {}}
    result = OllamaClient._parse_response(response, latency_ms=100)
    assert result.text == ""
    assert result.tool_calls == []
