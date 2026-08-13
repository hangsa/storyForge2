"""Regression tests for the novel_outline_generation prompt structure.

The "用户修改意见" mechanism was previously inert in practice: the text was
correctly threaded from frontend → endpoint → planner → prompt template, but
the LLM only weakly attended to it because (a) the system prompt never told
the model to honor user feedback, and (b) `{user_modifications}` was placed
AFTER the JSON output schema — at the lowest-attention position in the user
prompt.

These tests lock in the structural fixes so a future refactor can't silently
revert them. They assert on the rendered prompt (post-substitution) rather
than the raw YAML so they survive whitespace and quoting changes.
"""
from pathlib import Path

import pytest


PROMPT_PATH = (
    Path(__file__).resolve().parents[2] / "backend" / "prompts" / "novel_outline_generation.yaml"
)


@pytest.fixture(scope="module")
def prompt_data() -> dict:
    import yaml
    return yaml.safe_load(PROMPT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rendered_user_prompt(prompt_data) -> str:
    """Render the user prompt with empty user_modifications (the default)."""
    return prompt_data["user_prompt_template"].format(
        concept_context="(concept)",
        story_dna_context="(dna)",
        world_context="(world)",
        characters_context="(characters)",
        map_context="(map)",
        length_category="标准商业连载",
        target_total_words=1_000_000,
        min_words=2000,
        genre_beat_patterns="(beats)",
        genre_focus_vocabulary="(vocab)",
        genre_pacing="(pacing)",
        user_modifications="",
    )


def test_system_prompt_explicitly_instructs_to_honor_user_modifications(prompt_data):
    """Fix #1: the system prompt must tell the LLM that user feedback is a
    constraint, not a suggestion. Without this, the model's primary directive
    becomes "follow the schema" and the late-placed user text is ignored.
    """
    sys = prompt_data["system_prompt"]
    assert "用户修改意见" in sys, (
        "system_prompt must mention 用户修改意见 so the model treats it as a "
        "first-class constraint (regression: pre-fix system_prompt only had "
        "structural rules, user feedback was a post-script)."
    )
    # The instruction must be a directive, not a passing mention. Look for
    # imperative phrasing adjacent to the term.
    assert any(
        phrase in sys
        for phrase in ("必须", "严格", "不得忽略", "以用户意见为准")
    ), "system_prompt must contain an imperative directive about user feedback"


def test_user_modifications_placeholder_appears_before_json_schema(prompt_data):
    """Fix #2: `{user_modifications}` must be substituted BEFORE the JSON
    output schema in the rendered user prompt. The schema's first `{` opens
    the `{{` YAML-escaped example; everything after that is the schema block.
    """
    template = prompt_data["user_prompt_template"]
    mods_idx = template.find("{user_modifications}")
    schema_idx = template.find("{{")
    assert mods_idx != -1, "{user_modifications} placeholder must exist"
    assert schema_idx != -1, "JSON schema marker '{{' must exist"
    assert mods_idx < schema_idx, (
        f"{user_modifications!r} (idx {mods_idx}) must appear BEFORE the JSON "
        f"schema '{{' (idx {schema_idx}). Late-placed user text has the lowest "
        "attention weight — LLM tends to fill the schema first, then ignore."
    )


def test_user_modifications_block_renders_in_user_prompt(prompt_data):
    """When the planner wraps the user text with the 【用户修改意见】 marker
    (see backend/agents/_injection_helpers.py), that block must land inside
    the user prompt body — not get dropped by an extra `.format` arg.
    """
    rendered = prompt_data["user_prompt_template"].format(
        concept_context="(concept)",
        story_dna_context="(dna)",
        world_context="(world)",
        characters_context="(characters)",
        map_context="(map)",
        length_category="标准商业连载",
        target_total_words=1_000_000,
        min_words=2000,
        genre_beat_patterns="(beats)",
        genre_focus_vocabulary="(vocab)",
        genre_pacing="(pacing)",
        user_modifications="\n【用户修改意见】\n主角必须走废柴逆袭路线",
    )
    assert "【用户修改意见】" in rendered
    assert "主角必须走废柴逆袭路线" in rendered
    # The block must sit before the schema (sanity check on the rendered form,
    # complements test_user_modifications_placeholder_appears_before_json_schema
    # which asserts on the raw template).
    block_idx = rendered.find("【用户修改意见】")
    schema_idx = rendered.find("{")
    assert block_idx < schema_idx, (
        "User feedback block must appear before the first `{` of the JSON schema"
    )


def test_existing_structural_requirements_still_present(prompt_data):
    """Sanity check: fix didn't accidentally drop one of the original 8 rules."""
    sys = prompt_data["system_prompt"]
    assert "全书大纲" in sys
    assert "卷数" in sys or "卷" in sys
    assert "里程碑" in sys
    assert "只输出 JSON" in sys