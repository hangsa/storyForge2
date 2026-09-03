"""Integration tests for v2 endpoints: /init -> /state -> /next-step -> /select."""
import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.config import settings


def _run(coro):
    """Run coroutine synchronously (pytest-asyncio==0.23.0 + pytest==8.0.0 is broken)."""
    return asyncio.run(coro)


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "p_v2_init"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        '{"id": "p_v2_init", "genre": "xianxia"}', encoding="utf-8",
    )
    return pid


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(v2_router)
    return TestClient(app)


def _canvas_path(pid: str) -> Path:
    return Path(settings.projects_dir) / pid / "creative_os" / "canvas_state.json"


def test_init_writes_enriched_v4_schema_with_root_idea(project, client):
    """PRD §22 + §23.4 + UI design (root_idea card column)."""
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "修仙对抗外星舰队的可能性", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    # PRD §22 root_idea block (used by IdeaRootNode in design)
    assert canvas["root_idea"]["prompt"] == "修仙对抗外星舰队的可能性"
    assert canvas["root_idea"]["genre"] == "xianxia"
    assert "extracted" in canvas["root_idea"]
    # PRD §22 creative_session block (used by StepIndicator)
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["creative_session"]["max_steps"] == 5
    assert canvas["creative_session"]["status"] == "active"
    # PRD §22 top-level scores (used by QualityBar in option cards)
    assert "scores" in canvas
    assert canvas["scores"]["computed_at"]  # ISO timestamp
    # PRD §23.4 raw_intent double-write
    assert canvas["raw_intent"]["prompt"] == "修仙对抗外星舰队的可能性"


def test_init_writes_v4_with_raw_intent_and_root_idea(project, client):
    response = client.post(
        f"/creative/canvas/{project}/session/init",
        json={
            "prompt": "长生者寻死",
            "genre_primary": "xianxia",
            "genre_secondary": "xuanyi",
            "quick_mode": False,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["ok"] is True
    assert "session_id" in data
    assert "etag" in data

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["schema_version"] == 4
    assert canvas["raw_intent"]["prompt"] == "长生者寻死"
    assert canvas["root_idea"]["genre"] == "xianxia"
    assert len(canvas["creative_path"]) == 1
    assert canvas["creative_path"][0]["step"] == 1
    assert canvas["creative_path"][0]["state"] == "available"


def test_state_returns_v4_after_init(project, client):
    init_response = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    assert init_response.status_code == 200, init_response.text

    response = client.get(f"/creative/canvas/{project}/session/state")
    assert response.status_code == 200
    data = response.json()
    assert data["schema_version"] == 4


def test_next_step_404_when_canvas_not_initialized(project, client):
    response = client.post(
        f"/creative/canvas/{project}/session/next-step",
        json={"current_step": 1},
    )
    assert response.status_code in (400, 404)


def test_next_step_returns_operation_and_3_options(project, client, monkeypatch):
    init_response = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    assert init_response.status_code == 200, init_response.text

    # Stub _call_llm_with_retry directly — bypasses the LLM JSON retry helper.
    from backend.api import v2_canvas

    async def fake_llm_call(context):
        return (
            '{"operation": "twist", "operation_reason": "test",'
            '"options": ['
            '{"id": "opt_a", "title": "A", "premise": "p1", "logic": ""},'
            '{"id": "opt_b", "title": "B", "premise": "p2", "logic": ""},'
            '{"id": "opt_c", "title": "C", "premise": "p3", "logic": ""}'
            ']}'
        )

    async def fake_retry(llm_call, context, max_attempts=2):
        raw = await fake_llm_call(context)
        return json.loads(raw)

    monkeypatch.setattr(v2_canvas, "_call_llm_with_retry", fake_retry)

    response = client.post(
        f"/creative/canvas/{project}/session/next-step",
        json={"current_step": 1},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["operation"]["type"] == "twist"
    assert len(data["options"]) == 3
    assert all("id" in o for o in data["options"])
    # Step-scoped option ids (PRD §22: opt_{step}_{slot}); LLM prompt returns
    # opt_a/b/c — _next_step_impl must renumber so TreeCanvas can bind
    # selections back to the correct step + column.
    assert [o["id"] for o in data["options"]] == ["opt_1_a", "opt_1_b", "opt_1_c"]


def test_select_marks_step_completed_and_unlocks_next(project, client, monkeypatch):
    init_response = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    assert init_response.status_code == 200, init_response.text

    from backend.api import v2_canvas
    from backend.api.creative_diverge import _read_canvas, _write_canvas

    async def fake_next_step(project_id, current_step):
        options = [
            {"id": "opt_1_a", "title": "A", "premise": "p", "logic": "",
             "scores": {}},
            {"id": "opt_1_b", "title": "B", "premise": "p", "logic": "",
             "scores": {}},
            {"id": "opt_1_c", "title": "C", "premise": "p", "logic": "",
             "scores": {}},
        ]
        canvas = _read_canvas(project_id)
        # Ensure creative_path has an entry for current_step
        while len(canvas["creative_path"]) < current_step:
            canvas["creative_path"].append({
                "step": len(canvas["creative_path"]) + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": None,
                "created_at": "2026-09-02T00:00:00",
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
            "created_at": "2026-09-02T00:00:00",
            "selected_at": None,
            "regenerated_count": 0,
            "state": "active",
        }
        _write_canvas(project_id, canvas)
        return {
            "step": current_step,
            "operation": {"type": "twist", "name": "扭曲", "reason": ""},
            "options": options,
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next_step)

    ns_resp = client.post(
        f"/creative/canvas/{project}/session/next-step",
        json={"current_step": 1},
    )
    assert ns_resp.status_code == 200, ns_resp.text

    response = client.post(
        f"/creative/canvas/{project}/session/select",
        json={"step": 1, "option_id": "opt_1_b"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["ok"] is True
    assert data["step"] == 1
    assert data["selected_option_id"] == "opt_1_b"

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][0]["selected_option_id"] == "opt_1_b"


def test_delete_state_resets_session_preserves_root_idea(project, client, monkeypatch):
    """PRD §18.2: DELETE /state wipes creative_path but keeps root_idea."""
    from backend.api import v2_canvas
    from backend.api.creative_diverge import _read_canvas, _write_canvas

    async def fake_next_step(project_id, current_step):
        options = [
            {"id": f"opt_{current_step}_a", "title": "A", "premise": "p",
             "logic": "", "scores": {}},
            {"id": f"opt_{current_step}_b", "title": "B", "premise": "p",
             "logic": "", "scores": {}},
            {"id": f"opt_{current_step}_c", "title": "C", "premise": "p",
             "logic": "", "scores": {}},
        ]
        canvas = _read_canvas(project_id)
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
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next_step)

    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})
    client.post(f"/creative/canvas/{project}/session/next-step",
                json={"current_step": 1})
    client.post(f"/creative/canvas/{project}/session/select",
                json={"step": 1, "option_id": "opt_1_b"})

    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200

    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert canvas["creative_path"] == []
    assert canvas["creative_session"]["current_step"] == 1
    assert canvas["root_idea"]["prompt"] == "p"
    assert canvas["creative_session"]["status"] == "active"


def test_delete_state_when_uninitialized_is_idempotent(project, client):
    """DELETE /state on an uninitialized project is idempotent: safe to call repeatedly."""
    canvas_file = _canvas_path(project)

    # First DELETE on uninitialized project — should not 500
    first = client.delete(f"/creative/canvas/{project}/session/state")
    assert first.status_code == 200
    assert first.json()["ok"] is True
    assert not canvas_file.exists(), "canvas_state.json should not exist after first DELETE"

    # Second DELETE — must also be 200 (no-op since there is still no canvas)
    second = client.delete(f"/creative/canvas/{project}/session/state")
    assert second.status_code == 200
    assert second.json()["ok"] is True
    assert not canvas_file.exists(), "canvas_state.json should not exist after second DELETE"

    # Idempotent: identical response bodies for both calls
    assert first.json() == second.json()


def test_commit_writes_v3_compatible_concept_and_dna(project, client, monkeypatch):
    """v2 /commit must output concept_and_dna.json in v3 schema (no v2 new fields)."""
    from backend.api import v2_canvas
    from backend.api.creative_diverge import _read_canvas, _write_canvas
    from backend.agents.planner import PlannerAgent

    async def fake_generate(self, canvas_summary, genre="cool_novel"):
        return (
            {
                "concept": {"title": "T", "premise": "P", "genre": "xianxia",
                            "tone": "", "theme": "", "target_audience": "",
                            "style_template": "白描克制", "source": "canvas"},
                "story_dna": {
                    "core_contradiction": {"statement": "S", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"level": "personal", "value_a": "", "value_b": ""}] * 4,
                    "style_template": "白描克制",
                    "fusion_meta": None,
                },
            },
            None,
        )
    monkeypatch.setattr(PlannerAgent, "generate_concept_from_canvas", fake_generate)

    # Init + walk 5 steps + select
    client.post(f"/creative/canvas/{project}/session/init",
                json={"prompt": "p", "genre_primary": "xianxia"})

    async def fake_next(project_id, current_step):
        options = [
            {"id": f"opt_{current_step}_a", "title": "A", "premise": "p", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_b", "title": "B", "premise": "p", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_c", "title": "C", "premise": "p", "logic": "",
             "scores": {}},
        ]
        canvas = _read_canvas(project_id)
        while len(canvas["creative_path"]) < current_step:
            canvas["creative_path"].append({
                "step": len(canvas["creative_path"]) + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": None,
                "created_at": "2026-09-02T00:00:00",
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
            "created_at": "2026-09-02T00:00:00",
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

    for step in range(1, 6):
        client.post(f"/creative/canvas/{project}/session/next-step",
                    json={"current_step": step})
        client.post(f"/creative/canvas/{project}/session/select",
                    json={"step": step, "option_id": f"opt_{step}_b"})

    response = client.post(f"/creative/canvas/{project}/session/commit")
    assert response.status_code == 200, response.text

    # Verify v3 schema
    cnp = Path(settings.projects_dir) / project / "concept_and_dna.json"
    cnd = json.loads(cnp.read_text(encoding="utf-8"))
    assert "concept" in cnd
    assert "story_dna" in cnd
    assert "canvas_snapshot" in cnd
    # v2 NEW fields NOT written
    assert "creative_path" not in cnd
    assert "creative_mechanism" not in cnd
    assert "canvas_meta" not in cnd
    # canvas_snapshot.selected_path dual-written for backfill compat
    assert "selected_path" in cnd["canvas_snapshot"]
    assert len(cnd["canvas_snapshot"]["selected_path"]) == 5

