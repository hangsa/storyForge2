"""Cap _advance_chapter() at the outline's max chapter_number.

Conductor loop must NOT see FastAPI HTTPException semantics when the
cap is hit — a domain exception (OutlineExhaustedError) is raised
inside _advance_chapter(), and the /advance-chapter HTTP wrapper
translates it to HTTPException(400, code="OUTLINE_EXHAUSTED").
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    # stage4_writing.py binds `fm = FileManager(settings.projects_dir)` at
    # module import time — re-instantiate to point at this test's tmp_path.
    from backend.api.stage4_writing import fm
    fm.projects_dir = tmp_path
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_writing import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed(projects_dir: Path, pid: str, *, progress: dict,
          outline: dict | None) -> None:
    """Seed an STAGE4 project with explicit progress + (optional) outline."""
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    # StageStateMachine reads current_stage from project.json.
    (proj / "project.json").write_text(json.dumps({
        "id": pid, "title": "测试", "current_stage": "STAGE4",
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps(progress), encoding="utf-8")
    if outline is not None:
        (proj / "outline.json").write_text(json.dumps(outline), encoding="utf-8")


# ---------------------------------------------------------------------------
# Tests: OutlineExhaustedError raised at the domain layer
# ---------------------------------------------------------------------------

def test_advance_chapter_raises_domain_error_at_outline_max(projects_dir):
    """At the last outline chapter, _advance_chapter must raise
    OutlineExhaustedError (not HTTPException) so the conductor can
    catch it without importing FastAPI."""
    from backend.api.stage4_writing import _advance_chapter, OutlineExhaustedError
    from backend.api.stage4_writing import fm

    pid = "p_max"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 3, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  {"chapter_number": 2, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  {"chapter_number": 3, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
          ]})

    with pytest.raises(OutlineExhaustedError) as exc_info:
        import asyncio
        asyncio.run(_advance_chapter(pid, fake=True))

    err = exc_info.value
    assert getattr(err, "current_chapter", None) == 3
    assert getattr(err, "outline_max", None) == 3
    assert getattr(err, "project_id", None) == pid


def test_advance_chapter_succeeds_below_outline_max(projects_dir):
    """Regression: when current_chapter < outline_max, _advance_chapter
    must NOT raise OutlineExhaustedError. (Uses fake=True to skip LLM.)"""
    from backend.api.stage4_writing import _advance_chapter
    import asyncio

    pid = "p_below"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 5,
              "chapters": [
                  {"chapter_number": 1, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 6)
          ]})

    result = asyncio.run(_advance_chapter(pid, fake=True))
    assert result["error"] is False
    assert result["code"] == "OK"
    # Did advance 1 -> 2
    assert result["detail"]["from_chapter"] == 1
    assert result["detail"]["to_chapter"] == 2


def test_advance_chapter_succeeds_when_outline_missing(projects_dir):
    """Regression: if outline.json does not exist (legacy project), no
    cap is applied — behavior matches pre-T1 code path."""
    from backend.api.stage4_writing import _advance_chapter
    import asyncio

    pid = "p_no_outline"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 100,
              "chapters": [
                  {"chapter_number": 1, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline=None)

    result = asyncio.run(_advance_chapter(pid, fake=True))
    assert result["error"] is False
    assert result["detail"]["to_chapter"] == 2


# ---------------------------------------------------------------------------
# Tests: HTTP wrapper translates domain error to HTTPException(400)
# ---------------------------------------------------------------------------

def test_advance_chapter_http_returns_400_outline_exhausted(client, projects_dir):
    """HTTP wrapper at /advance-chapter must convert OutlineExhaustedError
    to 400 with code='OUTLINE_EXHAUSTED' and detail={current_chapter, outline_max}."""
    pid = "p_http_max"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 3, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 3, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
          ]})

    r = client.post("/api/stage4/advance-chapter", json={"project_id": pid})
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "OUTLINE_EXHAUSTED"
    assert body["detail"]["detail"]["current_chapter"] == 3
    assert body["detail"]["detail"]["outline_max"] == 3


def test_advance_chapter_http_does_not_mutate_progress_at_max(
    client, projects_dir
):
    """When OUTLINE_EXHAUSTED is returned, progress.json MUST be unchanged
    on disk — no L2 update, no checkpoint, no scaffold append."""
    pid = "p_no_mutation"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 2, "total_chapters": 2,
              "chapters": [
                  {"chapter_number": 1, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  {"chapter_number": 2, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
          ]})

    progress_path = projects_dir / pid / "progress.json"
    before_text = progress_path.read_text(encoding="utf-8")

    r = client.post("/api/stage4/advance-chapter", json={"project_id": pid})
    assert r.status_code == 400

    after_text = progress_path.read_text(encoding="utf-8")
    assert before_text == after_text, (
        "progress.json must not be mutated when OUTLINE_EXHAUSTED is raised"
    )


def test_advance_chapter_http_succeeds_below_outline_max(
    client, projects_dir
):
    """Regression: HTTP wrapper still works correctly when current_chapter
    is below outline_max."""
    pid = "p_http_below"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})

    r = client.post("/api/stage4/advance-chapter", json={"project_id": pid})
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == "OK"
    assert body["detail"]["to_chapter"] == 2
