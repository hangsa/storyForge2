"""E2E smoke for the canvas-to-wizard dual-write contract.

The frontend wizard reads `creative_divergence.json` to detect step-1
completion. The v4 canvas commit endpoint dual-writes this file with
`selected_at=<now>` and `source="canvas"`, so the wizard's prefill
recognizes the canvas commit as step-1 completion and unlocks step 2
(概念 DNA). These tests guard that contract from regressing.

The wizard integration logic is frontend-only — these tests guard the
backend contract the frontend depends on.
"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.api.creative_diverge import _read_canvas, _write_canvas
from backend.agents.planner import PlannerAgent
from backend.config import settings


def _canvas_path(pid: str) -> Path:
    return Path(settings.projects_dir) / pid / "creative_os" / "canvas_state.json"


def _cd_compat_path(pid: str) -> Path:
    return Path(settings.projects_dir) / pid / "creative_divergence.json"


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "p_canvas_wizard"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        '{"id": "p_canvas_wizard", "genre": "xianxia"}', encoding="utf-8",
    )
    return pid


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(v2_router)
    return TestClient(app)


@pytest.fixture
def stub_planner(monkeypatch):
    """Stub PlannerAgent.generate_concept_from_canvas so /commit doesn't hit LLM."""
    async def fake_generate(self, canvas_summary, genre="xianxia"):
        return (
            {
                "concept": {"title": "T", "premise": "P", "genre": genre,
                            "tone": "", "theme": "", "target_audience": "",
                            "style_template": "", "source": "canvas"},
                "story_dna": {
                    "core_contradiction": {"statement": "S", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"level": l, "value_a": "", "value_b": ""}
                                    for l in ("personal", "social",
                                              "philosophical", "existential")],
                    # Non-empty style_template required to pass commit gate
                    # (real PlannerAgent always returns a default).
                    "style_template": "白描克制", "fusion_meta": None,
                },
            },
            None,
        )
    monkeypatch.setattr(PlannerAgent, "generate_concept_from_canvas", fake_generate)


@pytest.fixture
def stub_llm(monkeypatch):
    """Stub _next_step_impl so /next-step and the select-cascade skip LLM.

    Mirrors tests/test_v2_e2e.py's stub_llm: pre-fills creative_path gaps
    so /select can cascade into next-step without IndexError.
    """
    from backend.api import v2_canvas

    async def fake_next(project_id, current_step):
        options = [
            {"id": f"opt_{current_step}_a", "title": "A", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_b", "title": "B", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_c", "title": "C", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
        ]
        canvas = _read_canvas(project_id)
        # Extend path with locked stubs so creative_path[current_step-1] is in range.
        # Needed because /select (v2_canvas.py) cascades into _next_step_impl(step+1)
        # without first writing the new step's entry — this loop pre-fills the gap.
        while len(canvas["creative_path"]) < current_step:
            canvas["creative_path"].append({
                "step": len(canvas["creative_path"]) + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": None,
                "created_at": "2026-09-03T00:00:00",
                "selected_at": None,
                "regenerated_count": 0,
                "state": "locked",
            })
        canvas["creative_path"][current_step - 1] = {
            "step": current_step,
            "operation": "twist",
            "operation_reason": "",
            "options": options,
            "selected_option_id": None,
            "created_at": "2026-09-03T00:00:00",
            "selected_at": None,
            "regenerated_count": 0,
            "state": "active",
        }
        _write_canvas(project_id, canvas)
        return {
            "step": current_step,
            "operation": {"type": "twist", "name": "twist", "reason": ""},
            "options": options,
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next)


def _walk_and_commit(client, project_id, prompt="test idea"):
    """Helper: init -> 5x(next-step+select) -> commit. Returns commit response."""
    init_resp = client.post(
        f"/creative/canvas/{project_id}/session/init",
        json={"prompt": prompt, "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    for step in range(1, 6):
        ns = client.post(
            f"/creative/canvas/{project_id}/session/next-step",
            json={"current_step": step},
        )
        assert ns.status_code == 200, ns.text

        sel = client.post(
            f"/creative/canvas/{project_id}/session/select",
            json={"step": step, "option_id": f"opt_{step}_b"},
        )
        assert sel.status_code == 200, sel.text

    commit_resp = client.post(f"/creative/canvas/{project_id}/session/commit")
    return commit_resp


def test_canvas_commit_writes_creative_divergence_with_selected_at(
    project, client, stub_planner, stub_llm
):
    """End-to-end: init -> 5x(next-step+select) -> commit.

    Asserts creative_divergence.json exists with selected_at set
    (the wizard's prefill signal — completedSteps.includes(1) and
    completedStep1Surfaces contains both "canvas" and "divergence"
    via different code paths).
    """
    commit_resp = _walk_and_commit(client, project, prompt="test idea")
    assert commit_resp.status_code == 200, commit_resp.text

    # Verify creative_divergence.json dual-write
    cd_path = _cd_compat_path(project)
    assert cd_path.exists(), (
        "creative_divergence.json must be dual-written by /commit; "
        "wizard prefill reads selected_at from this file"
    )

    cd = json.loads(cd_path.read_text(encoding="utf-8"))
    # The wizard's prefill rule (WorkspaceWizardPanel.tsx):
    #   if (cdPayload && cdPayload.selected_at) { ... }
    # so selected_at must be truthy.
    assert cd.get("selected_at"), (
        f"selected_at must be set after /commit; got: {cd.get('selected_at')!r}"
    )
    # source="canvas" distinguishes canvas-source dual-writes from
    # source="creative_divergence" wizard commits. Both code paths
    # write selected_at; the source field is informational.
    assert cd.get("source") == "canvas"
    # prompt carries the user's intent so the Stage1 /concept guard
    # (stage1_concept.py:_read_creative_intent) can find INTENT.
    assert cd.get("prompt") == "test idea"


def test_canvas_commit_sets_committed_flag_and_timestamp(
    project, client, stub_planner, stub_llm
):
    """Wizard's canvas-side prefill rule:
        if (canvasPayload?.committed === true && canvasPayload.committed_at !== null)

    Asserts that /commit stamps both the boolean and a truthy timestamp.
    """
    commit_resp = _walk_and_commit(client, project, prompt="p")
    assert commit_resp.status_code == 200, commit_resp.text

    # Re-fetch state
    state_resp = client.get(f"/creative/canvas/{project}/session/state")
    assert state_resp.status_code == 200
    canvas = state_resp.json()

    assert canvas["committed"] is True, (
        f"committed must be true after /commit; got: {canvas['committed']!r}"
    )
    assert canvas["committed_at"], (
        f"committed_at must be truthy after /commit; got: {canvas['committed_at']!r}"
    )


def test_canvas_commit_idempotent_creative_divergence_write(
    project, client, stub_planner, stub_llm
):
    """A second /commit (defensive) must not regress the selected_at signal.

    The wizard's prefill reads selected_at as a boolean — any truthy
    value marks step 1 complete. If a second commit clobbers
    selected_at with a stale value or null, the wizard could
    re-prefill step 1 as incomplete. Pin the contract.
    """
    # Init + walk + commit (first time)
    first_commit = _walk_and_commit(client, project, prompt="p")
    assert first_commit.status_code == 200, first_commit.text

    cd_path = _cd_compat_path(project)
    first = json.loads(cd_path.read_text(encoding="utf-8"))
    first_selected_at = first["selected_at"]

    # First commit must write selected_at (sanity).
    assert first_selected_at, "first commit must write selected_at"

    # The /commit endpoint may or may not be idempotent — we don't
    # assert the second call succeeds (it's blocked at the canvas
    # level if committed is already true). What we DO assert: the
    # creative_divergence.json file still has selected_at set (no
    # regression). If a second commit were attempted and failed
    # midway, the file should still be present.
    second = client.post(f"/creative/canvas/{project}/session/commit")
    cd_after = json.loads(cd_path.read_text(encoding="utf-8"))
    assert cd_after.get("selected_at"), (
        "selected_at must remain truthy after a (potentially re-entrant) commit; "
        f"got: {cd_after.get('selected_at')!r}"
    )
    # Either the second commit succeeded (200) or was rejected by a
    # canvas-level guard. In both cases, the dual-write file is intact.
    assert second.status_code in (200, 422, 409, 400), (
        f"unexpected status from second commit: {second.status_code} "
        f"{second.text}"
    )