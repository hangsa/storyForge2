"""Tests for the negative_constraints render helper.

render_negative_block is a pure-string utility that BaseAgent.load_prompt
calls to turn a user's free-text list into the `【禁止事项】` block
substituted into {negative_constraints}.
"""

from backend.services.prompt_override_store import render_negative_block


def test_empty_string_returns_empty():
    assert render_negative_block("") == ""


def test_whitespace_only_returns_empty():
    assert render_negative_block("   ") == ""
    assert render_negative_block("\n\n") == ""
    assert render_negative_block("  \n  \n  ") == ""


def test_single_line_renders_with_header_and_bullet():
    assert render_negative_block("不要使用回合制战斗描写") == (
        "\n\n【禁止事项】\n- 不要使用回合制战斗描写"
    )


def test_multi_line_trims_drops_blanks_and_bullets():
    assert render_negative_block(
        "  不要使用回合制战斗描写  \n"
        "不要出现现代品牌名\n"
        "\n"
        "禁止元婴/金丹/筑基"
    ) == (
        "\n\n【禁止事项】\n"
        "- 不要使用回合制战斗描写\n"
        "- 不要出现现代品牌名\n"
        "- 禁止元婴/金丹/筑基"
    )


# ---------------------------------------------------------------------------
# e2e: BaseAgent.load_prompt wires the render helper into the system prompt.
# ---------------------------------------------------------------------------

import json
import yaml
from pathlib import Path

import pytest

from backend.agents.base_agent import BaseAgent
from backend.services.prompt_override_store import (
    PromptOverrideStore,
    render_negative_block,  # noqa: F401  (re-export sanity)
)


@pytest.fixture
def nc_prompts_dir(tmp_path):
    """Synthetic prompts dir with {negative_constraints} placeholder."""
    (tmp_path / "with_placeholder.yaml").write_text(yaml.safe_dump({
        "system_prompt": "DEFAULT_SYS\n{negative_constraints}\nTAIL",
        "user_prompt_template": "user",
        "temperature": 0.7,
        "max_tokens": 1000,
    }))
    (tmp_path / "without_placeholder.yaml").write_text(yaml.safe_dump({
        "system_prompt": "DEFAULT_SYS_NO_PC\nTAIL",
        "user_prompt_template": "user",
        "temperature": 0.7,
        "max_tokens": 1000,
    }))
    return tmp_path


@pytest.fixture
def nc_projects_dir(tmp_path):
    return tmp_path


def _agent(prompts_dir, projects_dir, project_id):
    return BaseAgent(
        project_id=project_id,
        prompts_dir=prompts_dir,
        override_store=PromptOverrideStore(
            projects_dir=projects_dir, prompts_dir=prompts_dir
        ),
    )


class TestNegativeConstraintsInjection:
    def test_with_placeholder_and_value_substitutes_block(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p1"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "with_placeholder": {
                "negative_constraints": "不要使用回合制战斗描写",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p1")
        prompt = agent.load_prompt("with_placeholder", project_id="p1")
        out = prompt.format_system(negative_constraints="placeholder-supplied-here")
        assert "placeholder-supplied-here" not in out
        assert "【禁止事项】" in out
        assert "- 不要使用回合制战斗描写" in out
        assert "TAIL" in out

    def test_with_placeholder_and_empty_strips_placeholder(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p2"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "with_placeholder": {
                "negative_constraints": "",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p2")
        prompt = agent.load_prompt("with_placeholder", project_id="p2")
        out = prompt.format_system(negative_constraints="unused")
        assert "{negative_constraints}" not in out
        assert "【禁止事项】" not in out
        assert "DEFAULT_SYS\nTAIL" in out

    def test_no_placeholder_and_value_does_not_leak(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p3"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "without_placeholder": {
                "negative_constraints": "不要使用回合制战斗描写",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p3")
        prompt = agent.load_prompt("without_placeholder", project_id="p3")
        out = prompt.format_system(negative_constraints="unused")
        assert "不要使用回合制战斗描写" not in out
        assert "【禁止事项】" not in out
        assert "DEFAULT_SYS_NO_PC\nTAIL" in out

    def test_no_placeholder_and_empty_preserves_yaml_exactly(
        self, nc_prompts_dir, nc_projects_dir
    ):
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p4_no_override")
        prompt = agent.load_prompt("without_placeholder", project_id="p4_no_override")
        out = prompt.format_system(negative_constraints="unused")
        assert out == "DEFAULT_SYS_NO_PC\nTAIL"

    def test_placeholder_only_content_stripped_when_empty(
        self, nc_prompts_dir, nc_projects_dir
    ):
        """When the placeholder is the SOLE content of system_prompt (no
        surrounding newlines), the strip must still remove it so the LLM
        never sees a literal `{negative_constraints}` token."""
        (nc_prompts_dir / "placeholder_only.yaml").write_text(
            "system_prompt: '{negative_constraints}'\n"
            "user_prompt_template: 'whatever'\n"
            "negative_constraints: ''\n"
        )
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p5_sole")
        prompt = agent.load_prompt("placeholder_only", project_id="p5_sole")
        out = prompt.format_system(negative_constraints="unused")
        assert "{negative_constraints}" not in out
        assert out == ""
