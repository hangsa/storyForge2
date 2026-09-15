"""Regression tests for v2.x prompt-override wiring.

Three call sites previously loaded YAML directly and silently bypassed
the override stores, so Prompt Plaza edits had no runtime effect:

  1. NoveltyEvaluator.fill_trope_tags_async  — `trope_extraction`
  2. v2_canvas._load_next_step_prompt         — `canvas_v2_next_step`
  3. sandbox_renderer._load_prompt            — `sandbox_preview`

Each test writes a sentinel into a temp global override file, constructs
the unit with the same stores ThreeBEngine / BranchSimulator use, and
asserts the sentinel lands in the LLM message. Without the fix, the LLM
sees the unmodified YAML default and the assertion fails.

Mirrors `test_decompose_applies_global_override_for_firstness_decompose`
in test_api/test_three_b_routes.py.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
import yaml

from backend.config import settings
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
from backend.services.prompt_override_store import PromptOverrideStore


# ---------------------------------------------------------------------------
# Shared fixtures + helpers
# ---------------------------------------------------------------------------


def _make_stores(tmp_path: Path) -> tuple[GlobalPromptOverrideStore, PromptOverrideStore]:
    """Build a temp-backed (global, project) override store pair.

    Returns the *empty* stores — tests that need a sentinel write one into
    the global file BEFORE constructing the stores so the sentinel survives
    the JSON read on first use.
    """
    global_store = GlobalPromptOverrideStore(
        global_overrides_path=tmp_path / "global_prompt_overrides.json",
        prompts_dir=settings.prompts_dir,
    )
    project_store = PromptOverrideStore(
        projects_dir=tmp_path / "projects",
        prompts_dir=settings.prompts_dir,
    )
    return global_store, project_store


def _write_global_override(
    tmp_path: Path, name: str, system_marker: str, user_marker: str,
) -> Path:
    """Drop a sentinel global override for `name` into a temp file."""
    global_file = tmp_path / "global_prompt_overrides.json"
    global_file.write_text(
        json.dumps(
            {
                name: {
                    "system_prompt": f"{system_marker}\n{{negative_constraints}}",
                    "user_prompt_template": f"{user_marker} {{{{raw}}}}",
                    "_modified_at": "2026-09-11T00:00:00Z",
                }
            }
        ),
        encoding="utf-8",
    )
    return global_file


# ---------------------------------------------------------------------------
# 1. NoveltyEvaluator.fill_trope_tags_async
# ---------------------------------------------------------------------------


class _StubLLMClient:
    """Records the system + user prompt handed to .generate()."""

    def __init__(self) -> None:
        self.captured: dict = {}

    async def generate(self, *, system_prompt: str, user_prompt: str) -> Any:
        self.captured["system_prompt"] = system_prompt
        self.captured["user_prompt"] = user_prompt

        class _Resp:
            text = "tag_one, tag_two"
        return _Resp()


@pytest.mark.asyncio
async def test_novelty_evaluator_applies_global_override_for_trope_extraction(
    tmp_path, monkeypatch,
):
    """Regression: NoveltyEvaluator must thread stores into load_prompt_effective.

    Pre-fix the function called `load_prompt_effective("trope_extraction")`
    without stores, which silently returned YAML defaults. The fix accepts
    override_store/global_override_store in __init__ and a project_id arg
    on fill_trope_tags_async; both must land here for Prompt Plaza to work.
    """
    from backend.creative_os.novelty_evaluator import NoveltyEvaluator

    _write_global_override(
        tmp_path,
        "trope_extraction",
        system_marker="TROPE_GLOBAL_SYSTEM_MARKER",
        user_marker="TROPE_GLOBAL_USER_MARKER",
    )
    global_store, project_store = _make_stores(tmp_path)

    evaluator = NoveltyEvaluator(
        trope_pool=None,
        contradiction_engine=None,
        model_router=None,
        embedder=None,
        override_store=project_store,
        global_override_store=global_store,
    )

    client = _StubLLMClient()
    raw_intent = {"prompt": "test prompt text", "trope_tags": []}

    async def save_cb(_ri):
        pass

    await evaluator.fill_trope_tags_async(
        raw_intent=raw_intent,
        llm_client=client,
        save_callback=save_cb,
        project_id="p_ovr",
    )

    assert "TROPE_GLOBAL_SYSTEM_MARKER" in client.captured["system_prompt"], (
        f"global override not applied; got:\n{client.captured['system_prompt'][:200]}"
    )
    assert "TROPE_GLOBAL_USER_MARKER" in client.captured["user_prompt"]


# ---------------------------------------------------------------------------
# 2. v2_canvas._load_next_step_prompt
# ---------------------------------------------------------------------------


def test_v2_canvas_next_step_prompt_applies_global_override(tmp_path):
    """Regression: v2_canvas._load_next_step_prompt must use the override stores.

    Pre-fix the function cached the YAML at first call via a function-attribute
    cache and never re-read; even if you removed the cache, it called
    `yaml.safe_load` directly with no store wiring. The fix threads project_id
    + stores through both call sites (`_next_step_impl`, `_regenerate_options_with_hint`)
    and drops the cache so Plaza edits take effect immediately.
    """
    from backend.api.v2_canvas import _load_next_step_prompt

    _write_global_override(
        tmp_path,
        "canvas_v2_next_step",
        system_marker="NEXTSTEP_GLOBAL_SYSTEM_MARKER",
        user_marker="NEXTSTEP_GLOBAL_USER_MARKER",
    )
    global_store, project_store = _make_stores(tmp_path)

    prompt = _load_next_step_prompt(
        "p_ovr",
        override_store=project_store,
        global_override_store=global_store,
    )

    assert "NEXTSTEP_GLOBAL_SYSTEM_MARKER" in (prompt.get("system_prompt") or ""), (
        f"global override not applied; got:\n{prompt.get('system_prompt', '')[:200]}"
    )
    assert "NEXTSTEP_GLOBAL_USER_MARKER" in (prompt.get("user_prompt_template") or "")


def test_v2_canvas_next_step_prompt_yaml_only_when_no_stores(tmp_path):
    """Without stores, falls back to YAML default — backward compat.

    Existing call sites that never wired stores (none in this repo, but a
    safe default) get the YAML default unchanged.
    """
    from backend.api.v2_canvas import _load_next_step_prompt

    prompt = _load_next_step_prompt("p_ovr")
    yaml_path = Path(settings.prompts_dir) / "canvas_v2_next_step.yaml"
    with open(yaml_path, encoding="utf-8") as f:
        yaml_default = yaml.safe_load(f)
    assert prompt == yaml_default


# ---------------------------------------------------------------------------
# 3. sandbox_renderer._load_prompt
# ---------------------------------------------------------------------------


def test_sandbox_renderer_applies_global_override_for_sandbox_preview(tmp_path):
    """Regression: sandbox_renderer._load_prompt must use the override stores.

    Pre-fix the function used `yaml.safe_load` directly, so Prompt Plaza edits
    to `sandbox_preview` never reached the LLM. The fix threads stores through
    and renders sandbox previews from the merged dict.
    """
    from backend.style_engine.sandbox_renderer import _load_prompt

    _write_global_override(
        tmp_path,
        "sandbox_preview",
        system_marker="SANDBOX_GLOBAL_SYSTEM_MARKER",
        user_marker="SANDBOX_GLOBAL_USER_MARKER",
    )
    global_store, project_store = _make_stores(tmp_path)

    prompt = _load_prompt(
        "p_ovr",
        override_store=project_store,
        global_override_store=global_store,
    )

    assert "SANDBOX_GLOBAL_SYSTEM_MARKER" in (prompt.get("system_prompt") or ""), (
        f"global override not applied; got:\n{prompt.get('system_prompt', '')[:200]}"
    )
    assert "SANDBOX_GLOBAL_USER_MARKER" in (prompt.get("user_prompt_template") or "")


def test_sandbox_renderer_preview_renders_with_override(tmp_path):
    """End-to-end: render_preview must surface the override marker to the LLM.

    Builds a minimal mock model_router whose `.execute()` records the messages,
    then asserts the sentinel system prompt lands in the user-visible message.
    """
    from backend.style_engine.sandbox_renderer import render_preview
    from backend.style_engine.sandbox_models import (
        SandboxDialogueParams, SandboxDensityParams, SandboxParams,
        SandboxRhythmParams, SandboxSatisfactionParams, SandboxSentenceParams,
    )

    _write_global_override(
        tmp_path,
        "sandbox_preview",
        system_marker="SANDBOX_E2E_SYSTEM_MARKER",
        user_marker="SANDBOX_E2E_USER_MARKER",
    )
    global_store, project_store = _make_stores(tmp_path)

    captured: dict = {}

    async def fake_execute(*, agent_name, task_name, messages, **kwargs):
        captured["messages"] = messages
        return {"content": "改写后的文本"}

    router = AsyncMock()
    router.execute = fake_execute

    # Source text must satisfy PreviewRequest min_length=50; pad with dummy prose.
    source_text = "原文文本。" * 20
    params = SandboxParams(
        sentence=SandboxSentenceParams(
            avg_length_range=[10, 20], short_sentence_ratio=0.2,
        ),
        dialogue=SandboxDialogueParams(ratio=0.3, max_consecutive_lines=2),
        rhythm=SandboxRhythmParams(pacing_bpm=120, scene_change_frequency=0.2),
        density=SandboxDensityParams(description_ratio=0.4, action_ratio=0.5),
        satisfaction=SandboxSatisfactionParams(
            satisfaction_beat_count=2, suspense_hook_required=True,
        ),
    )

    resp = asyncio.run(
        render_preview(
            model_router=router,
            source_text=source_text,
            params=params,
            genre="玄幻",
            project_id="p_ovr",
            override_store=project_store,
            global_override_store=global_store,
        )
    )
    assert resp.rendered_text == "改写后的文本"
    sys_msg = captured["messages"][0]["content"]
    user_msg = captured["messages"][1]["content"]
    assert "SANDBOX_E2E_SYSTEM_MARKER" in sys_msg
    assert "SANDBOX_E2E_USER_MARKER" in user_msg
