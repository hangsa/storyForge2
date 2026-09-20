"""Tests for `_safe_format` — the prompt-format helper that survives
literal `{...}` in LLM-generated overrides.

Regression: proj_4e6f888f 2026-09-13 17:32. After meta_decompose picked up
the canonical 5-dim JSON template we just added to its prompt, the meta-LLM
copied the template verbatim into the override — including literal `{...}`
that the JSON template needs. The next /decompose call then loaded the
override and called `prompt.format(negative_constraints="")` which raised
`KeyError: '\n  "dimensions"'` → 503 DECOMPOSE_FAILED.

`_safe_format` does .format() but pre-escapes every `{X}` that is NOT a
known kwarg, so literal `{...}` survives .format() without being interpreted
as placeholders.
"""

from __future__ import annotations

import pytest

from backend.creative_os.b3_engine import _safe_format


def test_safe_format_substitutes_known_placeholder():
    """The normal case: a kwarg in kwargs is substituted."""
    out = _safe_format("hello {name}", name="world")
    assert out == "hello world"


def test_safe_format_escapes_literal_braces():
    """LLM-generated JSON template (literal braces) survives."""
    template = '{"dimensions": [{"dimension": "ontology"}]}'
    out = _safe_format(template, negative_constraints="")
    assert out == '{"dimensions": [{"dimension": "ontology"}]}'


def test_safe_format_escapes_literal_braces_with_kwarg():
    """Mix of literal JSON + a real placeholder — both work."""
    template = 'preamble {name} post {\n  "dimensions": []\n}'
    out = _safe_format(template, name="alice")
    assert out == 'preamble alice post {\n  "dimensions": []\n}'


def test_safe_format_preserves_doubled_braces():
    """YAML default with `{{...}}` → after _safe_format → `{...}` literal."""
    template = '{{"key": "value"}}'
    out = _safe_format(template, negative_constraints="")
    assert out == '{"key": "value"}'


def test_safe_format_passes_negative_constraints_through():
    """The actual call site for system_prompt in b3_engine.py."""
    template = "Some prompt.\n\n{negative_constraints}\nEnd."
    out = _safe_format(template, negative_constraints="")
    assert out == "Some prompt.\n\n\nEnd."
    # Non-empty negative_constraints also works
    out2 = _safe_format(
        template,
        negative_constraints="【禁止事项】\n- 不要 X",
    )
    assert "不要 X" in out2
    assert "{negative_constraints}" not in out2


def test_safe_format_does_not_touch_unmatched_braces():
    """Unmatched `{` without `}` is left alone — no regex match, no error."""
    template = "before { unmatched after"
    out = _safe_format(template, negative_constraints="")
    assert out == "before { unmatched after"


def test_safe_format_realistic_meta_generated_override():
    """The exact failure pattern from proj_4e6f888f: meta-LLM output
    containing the canonical JSON template (with literal braces) plus
    `{negative_constraints}` placeholder that the engine injects.
    """
    template = (
        "# 第一性拆解提示词\n\n"
        "some instructions here...\n\n"
        "```json\n"
        "{\n"
        '  "dimensions": [\n'
        '    {"dimension": "ontology", "insight": "i", "units": []}\n'
        "  ],\n"
        '  "causal_map": "",\n'
        '  "top_level_summary": ""\n'
        "}\n"
        "```\n\n"
        "{negative_constraints}\n"
    )
    out = _safe_format(template, negative_constraints="")
    # The JSON template is preserved literally
    assert '"dimensions": [' in out
    assert '{"dimension": "ontology"' in out
    # The placeholder is gone (replaced with empty string)
    assert "{negative_constraints}" not in out