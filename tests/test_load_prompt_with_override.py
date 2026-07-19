"""Tests for BaseAgent.load_prompt(name, project_id=None).

Verifies:
- Without project_id: identical behavior to today (YAML only).
- With project_id: YAML defaults are merged with project override.
- Backward compat: existing callers (no project_id) keep working.
"""

import pytest
import yaml
from pathlib import Path

from backend.agents.base_agent import BaseAgent
from backend.services.prompt_override_store import PromptOverrideStore


@pytest.fixture
def prompts_dir(tmp_path: Path) -> Path:
    (tmp_path / "scene_writing.yaml").write_text(yaml.safe_dump({
        "name": "scene_writing",
        "system_prompt": "default sys",
        "user_prompt_template": "default user",
        "temperature": 0.9,
        "max_tokens": 1000,
    }))
    return tmp_path


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    return tmp_path


def _make_agent(prompts_dir, projects_dir, project_id=None) -> BaseAgent:
    store = PromptOverrideStore(projects_dir=projects_dir, prompts_dir=prompts_dir)
    return BaseAgent(
        project_id=project_id or "proj_dummy",
        prompts_dir=prompts_dir,
        override_store=store,
    )


class TestBackwardCompat:
    def test_load_prompt_without_project_id_uses_yaml_only(self, prompts_dir, projects_dir):
        # Simulate legacy callers that don't know about overrides
        agent = BaseAgent(project_id="proj_dummy", prompts_dir=prompts_dir)
        # No override_store injected → no merging happens
        prompt = agent.load_prompt("scene_writing")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_but_no_override_uses_yaml(self, prompts_dir, projects_dir):
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_empty")
        prompt = agent.load_prompt("scene_writing", project_id="proj_empty")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_and_override_merges(self, prompts_dir, projects_dir):
        # Pre-seed an override
        proj = projects_dir / "proj_merged"
        proj.mkdir()
        import json
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_merged")
        prompt = agent.load_prompt("scene_writing", project_id="proj_merged")
        # Override applied
        assert prompt.temperature == 0.5
        # Non-overridden field untouched
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_partial_override_keeps_yaml_for_untouched_fields(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_partial"
        proj.mkdir()
        import json
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"system_prompt": "OVERRIDDEN", "_modified_at": "x"}
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_partial")
        prompt = agent.load_prompt("scene_writing", project_id="proj_partial")
        assert prompt.system_prompt == "OVERRIDDEN"
        assert prompt.user_prompt_template == "default user"  # still YAML
        assert prompt.temperature == 0.9  # still YAML
