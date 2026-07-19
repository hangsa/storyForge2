"""Tests for BaseAgent.load_prompt(name, project_id) — 3-tier override merge.

Verifies the layered contract:
- Layer 0 (YAML): always the base.
- Layer 1 (Global): merged on top when a global override store is configured;
  applies whether or not project_id is given.
- Layer 2 (Project): merged on top when project_id is given AND a per-project
  override store is configured.

Backward compat: with no stores configured, load_prompt returns YAML-only.
"""

import json
import pytest
import yaml
from pathlib import Path

from backend.agents.base_agent import BaseAgent
from backend.services.prompt_override_store import PromptOverrideStore
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore


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


def _project_store(prompts_dir, projects_dir) -> PromptOverrideStore:
    return PromptOverrideStore(projects_dir=projects_dir, prompts_dir=prompts_dir)


def _global_store(prompts_dir, global_path) -> GlobalPromptOverrideStore:
    return GlobalPromptOverrideStore(global_overrides_path=global_path, prompts_dir=prompts_dir)


def _make_agent(
    prompts_dir,
    projects_dir,
    project_id=None,
    global_store=None,
) -> BaseAgent:
    store = _project_store(prompts_dir, projects_dir)
    return BaseAgent(
        project_id=project_id or "proj_dummy",
        prompts_dir=prompts_dir,
        override_store=store,
        global_override_store=global_store,
    )


class TestBackwardCompat:
    def test_load_prompt_without_project_id_no_stores_uses_yaml_only(self, prompts_dir):
        # Legacy callers that don't know about overrides — no stores injected.
        agent = BaseAgent(project_id="proj_dummy", prompts_dir=prompts_dir)
        prompt = agent.load_prompt("scene_writing")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_without_project_id_no_global_store_uses_yaml_only(
        self, prompts_dir, projects_dir
    ):
        # Project store present but no global store: no project_id → still YAML-only.
        agent = _make_agent(prompts_dir, projects_dir)
        prompt = agent.load_prompt("scene_writing")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_but_no_override_uses_yaml(
        self, prompts_dir, projects_dir
    ):
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_empty")
        prompt = agent.load_prompt("scene_writing", project_id="proj_empty")
        assert prompt.temperature == 0.9
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_project_id_and_override_merges(self, prompts_dir, projects_dir):
        proj = projects_dir / "proj_merged"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "_modified_at": "2026-07-19T00:00:00Z",
            }
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_merged")
        prompt = agent.load_prompt("scene_writing", project_id="proj_merged")
        assert prompt.temperature == 0.5
        assert prompt.system_prompt == "default sys"

    def test_load_prompt_with_partial_override_keeps_yaml_for_untouched_fields(
        self, prompts_dir, projects_dir
    ):
        proj = projects_dir / "proj_partial"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"system_prompt": "OVERRIDDEN", "_modified_at": "x"}
        }))
        agent = _make_agent(prompts_dir, projects_dir, project_id="proj_partial")
        prompt = agent.load_prompt("scene_writing", project_id="proj_partial")
        assert prompt.system_prompt == "OVERRIDDEN"
        assert prompt.user_prompt_template == "default user"  # still YAML
        assert prompt.temperature == 0.9  # still YAML


class TestGlobalLayer:
    """Layer 1 (global) applies whether or not project_id is given."""

    def test_load_prompt_without_project_id_applies_global_override(
        self, prompts_dir, tmp_path
    ):
        global_path = tmp_path / "global_prompt_overrides.json"
        global_path.write_text(json.dumps({
            "scene_writing": {"system_prompt": "GLOBAL sys", "_modified_at": "x"}
        }))
        gstore = _global_store(prompts_dir, global_path)
        agent = BaseAgent(
            project_id="proj_dummy",
            prompts_dir=prompts_dir,
            global_override_store=gstore,
        )
        prompt = agent.load_prompt("scene_writing")
        # Global override applied
        assert prompt.system_prompt == "GLOBAL sys"
        # Untouched field still YAML
        assert prompt.temperature == 0.9

    def test_load_prompt_without_global_override_file_falls_back_to_yaml(
        self, prompts_dir, tmp_path
    ):
        # Global store configured but file doesn't exist → YAML-only.
        global_path = tmp_path / "does_not_exist.json"
        gstore = _global_store(prompts_dir, global_path)
        agent = BaseAgent(
            project_id="proj_dummy",
            prompts_dir=prompts_dir,
            global_override_store=gstore,
        )
        prompt = agent.load_prompt("scene_writing")
        assert prompt.system_prompt == "default sys"
        assert prompt.temperature == 0.9

    def test_project_id_path_also_applies_global_layer(
        self, prompts_dir, projects_dir, tmp_path
    ):
        # Global sets system_prompt; project has no override for scene_writing.
        global_path = tmp_path / "global_prompt_overrides.json"
        global_path.write_text(json.dumps({
            "scene_writing": {"system_prompt": "GLOBAL sys", "_modified_at": "x"}
        }))
        gstore = _global_store(prompts_dir, global_path)
        agent = _make_agent(
            prompts_dir, projects_dir, project_id="proj_g", global_store=gstore
        )
        prompt = agent.load_prompt("scene_writing", project_id="proj_g")
        # Global layer applied even on the project path
        assert prompt.system_prompt == "GLOBAL sys"
        assert prompt.temperature == 0.9

    def test_project_override_wins_over_global(
        self, prompts_dir, projects_dir, tmp_path
    ):
        # Global sets temperature=0.5, project sets temperature=0.3 → project wins.
        global_path = tmp_path / "global_prompt_overrides.json"
        global_path.write_text(json.dumps({
            "scene_writing": {
                "temperature": 0.5,
                "system_prompt": "GLOBAL sys",
                "_modified_at": "x",
            }
        }))
        gstore = _global_store(prompts_dir, global_path)
        proj = projects_dir / "proj_win"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "scene_writing": {"temperature": 0.3, "_modified_at": "y"}
        }))
        agent = _make_agent(
            prompts_dir, projects_dir, project_id="proj_win", global_store=gstore
        )
        prompt = agent.load_prompt("scene_writing", project_id="proj_win")
        # Project wins for temperature
        assert prompt.temperature == 0.3
        # Global still applies for system_prompt (project didn't touch it)
        assert prompt.system_prompt == "GLOBAL sys"
