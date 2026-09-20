"""Tests for `b3_engine._parse_json_or_raise` robustness.

Regression: deepseek (and other providers) sometimes wrap their JSON output in
a markdown code fence (` ```json ... ``` `) even when `response_format=
{"type": "json_object"}` is set — observed on firstness_decompose for
proj_47738f64 on 2026-09-11. The bare `json.loads(raw_text)` in the pre-fix
implementation rejected this with `JSONDecodeError`, surfacing to the user
as "decompose: LLM 返回非 JSON: Expecting ',' delimiter: line N column M".

`BaseAgent` / `Reviewer` already use `parse_json_text` for the same reason;
3B engine just hadn't been aligned. These tests pin the new contract.
"""

from __future__ import annotations

import pytest

from backend.creative_os.b3_engine import _parse_json_or_raise


VALID_PAYLOAD = {
    "dimensions": [
        {"dimension": "ontology", "insight": "ok", "units": []},
    ],
}


def test_parse_direct_json_object():
    """Happy path — bare JSON object parses cleanly."""
    text = '{"dimensions": [{"dimension": "ontology", "insight": "ok", "units": []}]}'
    out = _parse_json_or_raise(text, "decompose")
    assert out == VALID_PAYLOAD


def test_parse_json_fenced_with_json_marker():
    """Regression: most common LLM mode-leak — wrapped in ```json ... ```.

    Pre-fix this raised `JSONDecodeError: Expecting ',' delimiter: line 1`.
    """
    text = (
        "```json\n"
        '{"dimensions": [{"dimension": "ontology", "insight": "ok", "units": []}]}\n'
        "```"
    )
    out = _parse_json_or_raise(text, "decompose")
    assert out == VALID_PAYLOAD


def test_parse_json_fenced_without_json_marker():
    """Some models use bare ``` ... ``` (no language hint)."""
    text = (
        "```\n"
        '{"dimensions": [{"dimension": "ontology", "insight": "ok", "units": []}]}\n'
        "```"
    )
    out = _parse_json_or_raise(text, "decompose")
    assert out == VALID_PAYLOAD


def test_parse_json_with_leading_prose():
    """LLM sometimes prepends a sentence like 'Here is the JSON:' before the JSON."""
    text = (
        "好的,以下是该创意的拆解结果。\n"
        '{"dimensions": [{"dimension": "ontology", "insight": "ok", "units": []}]}\n'
    )
    out = _parse_json_or_raise(text, "decompose")
    assert out == VALID_PAYLOAD


def test_parse_json_with_trailing_prose():
    """LLM sometimes appends a closing remark after the JSON."""
    text = (
        '{"dimensions": [{"dimension": "ontology", "insight": "ok", "units": []}]}\n'
        "如果需要调整请告诉我。\n"
    )
    out = _parse_json_or_raise(text, "decompose")
    assert out == VALID_PAYLOAD


def test_parse_truly_unparseable_still_raises():
    """Defense-in-depth: garbage input must still raise — silent accept would mask bugs."""
    text = "this is not JSON at all, no braces, no fence"
    with pytest.raises(ValueError, match="LLM 返回非 JSON"):
        _parse_json_or_raise(text, "decompose")


def test_parse_empty_string_raises():
    """Empty LLM response (model refused / truncated) should fail loudly."""
    with pytest.raises(ValueError, match="LLM 返回非 JSON"):
        _parse_json_or_raise("", "decompose")


# ── Regression: reasoning-model <think> pollution ──────────────────────
#
# proj_4e6f888f 2026-09-13: MiniMax-M3-style reasoning models wrap their
# chain-of-thought inside <think>...</think> and put the actual answer
# AFTER `</think>`. Without a strip, two failure modes surfaced:
#   (a) `invoke_meta_llm` saved the think block as the project's
#       `firstness_decompose.system_prompt` override → next /decompose
#       loaded a polluted system_prompt → LLM responded inside ANOTHER
#       think block → parse_json_or_raise crashed with "无法解析".
#   (b) Even with a clean override, any 3B LLM call (decompose / commit /
#       follow_up) on a reasoning model returns JSON wrapped in think tags.
#
# The fix strips the think block at TWO layers: invoke_meta_llm (write-time,
# keeps the saved override clean) AND _parse_json_or_raise (read-time,
# defense-in-depth for any pre-fix pollution + non-meta paths).

THINKED_PAYLOAD = {
    "dimensions": [
        {"dimension": "ontology", "insight": "x", "units": []},
    ],
    "causal_map": "cm",
    "top_level_summary": "summary",
}


def test_parse_strips_think_block_before_json():
    """Reasoning-model output with <think> wrapper must parse cleanly."""
    import json as _json
    wrapped = (
        "<think>The user wants 5 dimensions. Let me draft them...</think>\n"
        + _json.dumps(THINKED_PAYLOAD)
    )
    parsed = _parse_json_or_raise(wrapped, "decompose")
    assert parsed == THINKED_PAYLOAD


def test_parse_strips_think_block_with_prose_between():
    """Prose after </think> (e.g. ```json fence) must not confuse the parser."""
    import json as _json
    wrapped = (
        "<think>self-review noise</think>"
        "Here is the answer:\n"
        "```json\n"
        + _json.dumps(THINKED_PAYLOAD)
        + "\n```"
    )
    parsed = _parse_json_or_raise(wrapped, "decompose")
    assert parsed == THINKED_PAYLOAD


def test_parse_handles_unterminated_think_via_parse_json_text_fallback():
    """Unterminated `<think>` (no closer): the strip is a no-op, but
    `parse_json_text` scans for the first JSON-looking block in the tail.
    Result: parse succeeds, the prose prefix is silently dropped. This is
    intentional — the closed-form think block is what reasoning models
    actually emit in production; unterminated is a rare truncation edge
    case where the surviving JSON is the load-bearing part anyway.
    """
    import json as _json
    wrapped = "<think>got cut off mid-thought " + _json.dumps(THINKED_PAYLOAD)
    parsed = _parse_json_or_raise(wrapped, "decompose")
    assert parsed == THINKED_PAYLOAD


def test_parse_think_only_no_answer_still_raises():
    """Defense-in-depth: think-only output (model never produced JSON) must fail."""
    wrapped = "<think>just thinking, no answer</think>"
    with pytest.raises(ValueError, match="LLM 返回非 JSON"):
        _parse_json_or_raise(wrapped, "decompose")
