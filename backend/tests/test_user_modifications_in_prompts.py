"""Cross-prompt regression: every prompt that accepts {user_modifications}
must treat it as a first-class constraint, not a late-placed suggestion.

For each affected prompt we assert two structural invariants:
  1. system_prompt mentions "用户修改意见" with an imperative directive
     ("必须" / "严格" / "不得忽略" / "以用户意见为准"), so the LLM treats
     user feedback as a constraint alongside the schema.
  2. The `{user_modifications}` placeholder appears in user_prompt_template
     BEFORE the JSON schema marker `{{` — late-placed user text has the
     lowest attention weight, so the model fills the schema first and
     ignores the feedback.

Per-prompt coverage of the novel_outline_generation case lives in
test_novel_outline_generation_prompt.py. This file layers a parameterized
check on top to prevent the same regression from creeping into any other
prompt later.
"""
from pathlib import Path

import pytest
import yaml


PROMPTS_DIR = Path(__file__).resolve().parents[2] / "backend" / "prompts"


# (prompt_name, schema_marker) — for scene_writing the output is wrapped in
# {"text": "..."}, but the schema still opens with `{{` so the same regex
# works uniformly.
PROMPTS = [
    "concept_generation",
    "world_generation",
    "character_generation",
    "outline_generation",
    "novel_outline_generation",
    "scene_writing",
]


def _load(prompt_name: str) -> dict:
    path = PROMPTS_DIR / f"{prompt_name}.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def loaded_prompts() -> dict[str, dict]:
    return {name: _load(name) for name in PROMPTS}


@pytest.mark.parametrize("prompt_name", PROMPTS)
def test_system_prompt_directs_model_to_honor_user_modifications(prompt_name, loaded_prompts):
    """Fix #1: system_prompt must tell the LLM that user feedback is a
    constraint, not a suggestion. Without this, the model's primary directive
    becomes "follow the schema" and the late-placed user text is ignored.
    """
    sys = loaded_prompts[prompt_name]["system_prompt"]
    assert "用户修改意见" in sys, (
        f"{prompt_name}.yaml system_prompt must mention 用户修改意见 so the "
        "model treats user feedback as a first-class constraint"
    )
    assert any(
        phrase in sys
        for phrase in ("必须", "严格", "不得忽略", "以用户意见为准")
    ), (
        f"{prompt_name}.yaml system_prompt must contain an imperative "
        "directive about user feedback (必须 / 严格 / 不得忽略 / 以用户意见为准)"
    )


@pytest.mark.parametrize("prompt_name", PROMPTS)
def test_user_modifications_placeholder_appears_before_json_schema(prompt_name, loaded_prompts):
    """Fix #2: `{user_modifications}` must be substituted BEFORE the JSON
    schema marker `{{` so the model attends to it instead of dropping it
    once the schema is filled.

    `.format()` is pure substitution, so if the placeholder precedes the
    schema in the raw template the rendered prompt inherits the same
    ordering — this is the single source of truth for placement.
    """
    template = loaded_prompts[prompt_name]["user_prompt_template"]
    mods_idx = template.find("{user_modifications}")
    schema_idx = template.find("{{")
    assert mods_idx != -1, f"{prompt_name} missing {{user_modifications}} placeholder"
    assert schema_idx != -1, f"{prompt_name} missing JSON schema marker '{{{{'"
    assert mods_idx < schema_idx, (
        f"{prompt_name}: {{user_modifications}} (idx {mods_idx}) must appear "
        f"BEFORE the JSON schema '{{' (idx {schema_idx}). Late-placed user "
        "text has the lowest attention weight — LLM tends to fill the schema "
        "first, then ignore."
    )
