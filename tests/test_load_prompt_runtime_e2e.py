"""End-to-end regression test: user prompt override → next LLM call sees it.

Proves the v1.9 wiring fix. The bug pre-fix: `BaseAgent.load_prompt()` would
read from YAML on every call (with stores defaulting to None) because the
stores were never injected into the constructors in `backend/api/*.py`.
After the fix, an override written to `projects/{id}/prompt_overrides.json`
must appear in the `system_prompt` argument passed to the LLM provider —
no server restart, no process-level cache to bust.

Coverage:
- Project override flows through to `provider.generate(system_prompt=...)`
- Global override flows through to `provider.generate(system_prompt=...)`
- Project trumps global when both are set
- YAML-only path still works (backward compat for tests that don't inject stores)
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from backend.agents.base_agent import BaseAgent
from backend.llm.base_provider import BaseLLMProvider, LLMResponse
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
from backend.services.prompt_override_store import PromptOverrideStore


# --- helpers ------------------------------------------------------------------


class CapturingProvider(BaseLLMProvider):
    """Fake LLM provider that records every generate() call's prompt arguments."""

    def __init__(self, response_text: str = "ok") -> None:
        self.calls: list[tuple[str, str]] = []
        self._response_text = response_text

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs: Any,
    ) -> LLMResponse:
        self.calls.append((system_prompt, user_prompt))
        return LLMResponse(
            text=self._response_text,
            tokens_in=len(system_prompt) + len(user_prompt),
            tokens_out=len(self._response_text),
            model="fake",
            provider="fake",
        )

    async def generate_stream(self, *args: Any, **kwargs: Any):  # pragma: no cover
        raise NotImplementedError

    @property
    def supports_json_mode(self) -> bool:
        return False


@pytest.fixture
def prompts_root(tmp_path: Path) -> Path:
    """Bare-bones backend/prompts/ replacement with just `scene_writing.yaml`."""
    (tmp_path / "scene_writing.yaml").write_text(
        yaml.safe_dump(
            {
                "name": "scene_writing",
                "system_prompt": "YAML_SYS",
                "user_prompt_template": "YAML_USER {scene_plan}",
                "temperature": 0.9,
                "max_tokens": 1000,
            }
        )
    )
    return tmp_path


@pytest.fixture
def projects_root(tmp_path: Path) -> Path:
    """Bare-bones projects/ replacement; per-project override dirs created per-test."""
    return tmp_path / "projects"


def _build_agent(
    prompts_dir: Path,
    projects_dir: Path,
    project_id: str,
    global_path: Path | None = None,
) -> BaseAgent:
    """Construct a BaseAgent wired to tmp stores.

    Mirrors the production wiring done in `backend/services/agent_prompt_stores.py` —
    ProjectOverrideStore + GlobalPromptOverrideStore both injected, project_id set.
    """
    store = PromptOverrideStore(projects_dir=projects_dir, prompts_dir=prompts_dir)
    gstore: GlobalPromptOverrideStore | None = None
    if global_path is not None:
        gstore = GlobalPromptOverrideStore(
            global_overrides_path=global_path, prompts_dir=prompts_dir
        )
    return BaseAgent(
        project_id=project_id,
        prompts_dir=prompts_dir,
        override_store=store,
        global_override_store=gstore,
    )


def _write_project_override(
    projects_dir: Path, project_id: str, name: str, fields: dict
) -> None:
    proj = projects_dir / project_id
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "prompt_overrides.json").write_text(json.dumps({name: fields}))


def _write_global_override(global_path: Path, name: str, fields: dict) -> None:
    global_path.parent.mkdir(parents=True, exist_ok=True)
    global_path.write_text(json.dumps({name: fields}))


def _run_agent_generate_from_template(agent: BaseAgent) -> CapturingProvider:
    """Install a capturing fake provider and trigger one generate_from_template() call."""
    fake = CapturingProvider()
    agent._provider = fake  # type: ignore[assignment]
    asyncio.run(agent.generate_from_template("scene_writing", scene_plan="<x>"))
    assert len(fake.calls) == 1, f"expected exactly 1 LLM call, got {len(fake.calls)}"
    return fake


# --- test cases ---------------------------------------------------------------


class TestPromptOverrideRuntimeFlow:
    def test_yaml_only_path_backward_compat(self, prompts_root: Path) -> Path:
        """When no overrides exist, the LLM sees the YAML defaults exactly.

        Regression — pre-fix behavior must still work for any caller that
        does not yet inject stores.
        """
        agent = BaseAgent(project_id="p1", prompts_dir=prompts_root)
        fake = _run_agent_generate_from_template(agent)

        system_sent, _ = fake.calls[0]
        assert "YAML_SYS" in system_sent
        assert "_OVERRIDE" not in system_sent

    def test_project_override_reaches_llm(
        self, prompts_root: Path, projects_root: Path
    ):
        """Project override must appear in the `system_prompt` arg sent to LLM."""
        _write_project_override(
            projects_root, "p1", "scene_writing",
            {"system_prompt": "PROJECT_OVERRIDE_SYS"},
        )
        agent = _build_agent(prompts_root, projects_root, project_id="p1")
        fake = _run_agent_generate_from_template(agent)

        system_sent, _ = fake.calls[0]
        assert "PROJECT_OVERRIDE_SYS" in system_sent, (
            f"override text missing from LLM call: {system_sent!r}"
        )
        assert "YAML_SYS" not in system_sent, "YAML should be overridden away"

    def test_project_override_takes_effect_without_process_restart(
        self, prompts_root: Path, projects_root: Path
    ):
        """Two consecutive writes to prompt_overrides.json must both be seen.

        Catches the older bug where agent instances cached the prompt at
        __init__ — second write would not flow through.
        """
        _write_project_override(
            projects_root, "p1", "scene_writing",
            {"system_prompt": "FIRST_OVERRIDE"},
        )
        agent = _build_agent(prompts_root, projects_root, project_id="p1")
        fake = _run_agent_generate_from_template(agent)
        first_sys, _ = fake.calls[0]
        assert "FIRST_OVERRIDE" in first_sys

        # Now mutate the JSON to a different override and call again — same agent,
        # no instance rebuild, no restart. v1.9 must pick this up.
        _write_project_override(
            projects_root, "p1", "scene_writing",
            {"system_prompt": "SECOND_OVERRIDE"},
        )
        asyncio.run(agent.generate_from_template("scene_writing", scene_plan="<x>"))
        assert len(fake.calls) == 2
        second_sys, _ = fake.calls[1]
        assert "SECOND_OVERRIDE" in second_sys
        assert "FIRST_OVERRIDE" not in second_sys

    def test_global_override_reaches_llm_when_no_project_override(
        self, prompts_root: Path, projects_root: Path
    ):
        """Global defaults apply when there is no project override."""
        global_path = projects_root.parent / "global_overrides.json"
        _write_global_override(
            global_path, "scene_writing", {"system_prompt": "GLOBAL_SYS"}
        )
        # No project override present.
        agent = _build_agent(
            prompts_root, projects_root, project_id="p1", global_path=global_path
        )
        fake = _run_agent_generate_from_template(agent)

        system_sent, _ = fake.calls[0]
        assert "GLOBAL_SYS" in system_sent
        assert "YAML_SYS" not in system_sent

    def test_project_override_trumps_global(
        self, prompts_root: Path, projects_root: Path
    ):
        """When both override stores have a value, project wins (Layer 2 > Layer 1)."""
        global_path = projects_root.parent / "global_overrides.json"
        _write_global_override(
            global_path, "scene_writing", {"system_prompt": "GLOBAL_SYS"}
        )
        _write_project_override(
            projects_root, "p1", "scene_writing",
            {"system_prompt": "PROJECT_OVERRIDE_SYS"},
        )
        agent = _build_agent(
            prompts_root, projects_root, project_id="p1", global_path=global_path
        )
        fake = _run_agent_generate_from_template(agent)

        system_sent, _ = fake.calls[0]
        assert "PROJECT_OVERRIDE_SYS" in system_sent
        assert "GLOBAL_SYS" not in system_sent

    def test_user_template_kwargs_flow_into_user_prompt(
        self, prompts_root: Path, projects_root: Path
    ):
        """Project override of `user_prompt_template` is honored AND kwargs are
        formatted into the user prompt before being sent to the LLM."""
        _write_project_override(
            projects_root, "p1", "scene_writing",
            {"user_prompt_template": "PROJECT_USER {scene_plan}"},
        )
        agent = _build_agent(prompts_root, projects_root, project_id="p1")
        fake = _run_agent_generate_from_template(agent)

        _, user_sent = fake.calls[0]
        assert "PROJECT_USER" in user_sent
        assert "<x>" in user_sent, "scene_plan kwarg should be substituted"
        assert "YAML_USER" not in user_sent

    def test_temperature_override_reaches_prompt_template(
        self, prompts_root: Path, projects_root: Path
    ):
        """Project override of `temperature` flows into the `PromptTemplate` that
        BaseAgent passes to the provider (visible via `prompt.temperature`)."""
        _write_project_override(
            projects_root, "p1", "scene_writing", {"temperature": 0.11}
        )
        agent = _build_agent(prompts_root, projects_root, project_id="p1")
        p = agent.load_prompt("scene_writing", project_id="p1")
        assert p.temperature == 0.11
