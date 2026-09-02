"""Verify next-step prompt YAML + LLM JSON retry helper (spec §6.5)."""
import asyncio
import json

import pytest

from backend.api.v2_canvas import _call_llm_with_retry, _load_next_step_prompt


def _run(coro):
    """Run coroutine synchronously (pytest-asyncio==0.23.0 + pytest==8.0.0 is broken)."""
    return asyncio.run(coro)


def test_load_prompt_has_system_and_user_sections():
    prompt = _load_next_step_prompt()
    assert "system" in prompt, "YAML missing 'system' section"
    assert "user" in prompt, "YAML missing 'user' section"
    # system must instruct JSON output with operation + options
    assert "operation" in prompt["system"]
    assert "options" in prompt["system"]
    # user template must include the placeholders the spec requires
    user = prompt["user"]
    for placeholder in (
        "{premise}",
        "{core_conflict}",
        "{characters}",
        "{world_rules}",
        "{tropes}",
        "{themes}",
        "{selected_path_summary}",
        "{current_step}",
        "{max_steps}",
        "{candidate_operation_hint}",
    ):
        assert placeholder in user, f"user template missing {placeholder}"


def test_call_llm_with_retry_succeeds_first_try():
    payload = {"operation": "twist", "operation_reason": "low novelty", "options": [{}, {}, {}]}

    async def fake_llm(prompt):
        return json.dumps(payload)

    async def run():
        return await _call_llm_with_retry(fake_llm, {"any": "ctx"})

    result = _run(run())
    assert result["operation"] == "twist"
    assert len(result["options"]) == 3


def test_call_llm_with_retry_retries_on_invalid_json():
    calls = {"count": 0}
    valid = json.dumps({"operation": "twist", "options": [{}, {}, {}]})

    async def fake_llm(prompt):
        calls["count"] += 1
        if calls["count"] == 1:
            return "not valid json {"
        return valid

    async def run():
        return await _call_llm_with_retry(fake_llm, {"any": "ctx"})

    result = _run(run())
    assert calls["count"] == 2
    assert result["operation"] == "twist"


def test_call_llm_with_retry_raises_after_2_failures():
    async def fake_llm(prompt):
        return "garbage"

    async def run():
        await _call_llm_with_retry(fake_llm, {"any": "ctx"})

    with pytest.raises(RuntimeError, match="LLM"):
        _run(run())
