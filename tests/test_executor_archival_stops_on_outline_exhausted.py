"""T3: AsyncStage4Executor._archival must catch OutlineExhaustedError from
_advance_chapter, stop the autopilot session, and return a structured
{"status": "stopped", "reason": "outline_exhausted", ...} payload.

The mgr.stop() path is already idempotent (covered by
test_autopilot_session_persistence.py::TestIdempotency::test_stop_when_already_stopped_is_noop);
this file focuses on the executor's response to the domain error and
verifies the session is correctly transitioned to STOPPED.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from backend.api.stage4_writing import OutlineExhaustedError
from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor import stage4_async_executor as ex_mod
from backend.conductor.stage4_async_executor import AsyncStage4Executor
from backend.models.autopilot_session import ManagedStartConfig, QueueItem, SessionState


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    """Bind both settings.projects_dir and the module-level FileManager in
    stage4_writing.py to tmp_path so file I/O lands in the test sandbox."""
    from backend.config import settings
    from backend.api.stage4_writing import fm
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    return tmp_path


@pytest.fixture
def pid() -> str:
    return "p_archival_exhausted"


@pytest.fixture
def mgr(projects_dir, pid):
    return AutopilotSessionManager(projects_dir, pid)


def _seed_one_chapter_outline(projects_dir: Path, pid: str) -> None:
    """Seed a 1-chapter project so any advance past current_chapter=1 hits the cap."""
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "project.json").write_text(json.dumps({
        "id": pid, "title": "T3", "current_stage": "STAGE4", "genre": "cool_novel",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    # Outline with chapter_number=1 only — outline_max=1.
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [
            {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
        ],
    }), encoding="utf-8")
    # current_chapter=1, all 1 scene completed so _advance_chapter's
    # "all scenes done" precondition passes and the cap is the only reason
    # the call would raise.
    (proj / "progress.json").write_text(json.dumps({
        "project_id": pid, "current_stage": "STAGE4",
        "current_chapter": 1, "total_chapters": 1,
        "chapters": [
            {"chapter_number": 1, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
        ],
        "circuit_breaker_events": [],
    }), encoding="utf-8")


def _make_archival_item(chapter: int = 1) -> QueueItem:
    return QueueItem(
        id=f"archive-{chapter}", kind="archival", chapter_number=chapter,
        scheduled_at=None, priority=10, payload={},
    )


# ---------------------------------------------------------------------------
# Test 1: _archival stops the session and returns the structured payload
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_archival_stops_session_when_outline_exhausted(
    mgr, projects_dir, pid, monkeypatch
):
    """When _advance_chapter raises OutlineExhaustedError, _archival must
    call mgr.stop() (if state==RUNNING) and return the structured
    "stopped"/"outline_exhausted" payload."""
    _seed_one_chapter_outline(projects_dir, pid)
    mgr.start(ManagedStartConfig())
    assert mgr.load().state == SessionState.RUNNING

    executor = AsyncStage4Executor(projects_dir)
    result = await executor.execute(_make_archival_item(chapter=1), project_id=pid)

    assert result["status"] == "stopped"
    assert result["reason"] == "outline_exhausted"
    assert result["current_chapter"] == 1
    assert result["outline_max"] == 1
    # Session transitioned to STOPPED.
    s = mgr.load()
    assert s.state == SessionState.STOPPED


# ---------------------------------------------------------------------------
# Test 2: _archival handles state==STOPPED cleanly (no exception, no re-stop event)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_archival_when_session_already_stopped_does_not_raise_or_double_stop(
    mgr, projects_dir, pid
):
    """If the session is already STOPPED when _archival runs, the cap still
    raises OutlineExhaustedError, but we must NOT redundantly re-stop or
    raise — we just return the structured payload."""
    _seed_one_chapter_outline(projects_dir, pid)
    mgr.start(ManagedStartConfig())
    mgr.stop()
    assert mgr.load().state == SessionState.STOPPED

    executor = AsyncStage4Executor(projects_dir)
    result = await executor.execute(_make_archival_item(chapter=1), project_id=pid)

    assert result["status"] == "stopped"
    assert result["reason"] == "outline_exhausted"
    # Session stays STOPPED.
    s = mgr.load()
    assert s.state == SessionState.STOPPED
    # No new task_complete events (the idempotency guarantee: stop() is a no-op).
    completes = [e for e in s.history if e.type == "task_complete"]
    # 1 task_complete from the original stop(); we should not see a second one.
    assert len(completes) == 1


# ---------------------------------------------------------------------------
# Test 3: regression — _archival below the cap still enqueues next chapter
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_archival_below_outline_max_still_advances_and_seeds(
    mgr, projects_dir, pid
):
    """Regression: when current_chapter < outline_max, _archival must NOT
    take the OutlineExhaustedError branch — it must run the normal flow
    (advance + enqueue next chapter's scenes)."""
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "project.json").write_text(json.dumps({
        "id": pid, "title": "T3 reg", "current_stage": "STAGE4", "genre": "cool_novel",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    # Two-chapter outline so current_chapter=1 has room to advance.
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [
            {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
        ],
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps({
        "project_id": pid, "current_stage": "STAGE4",
        "current_chapter": 1, "total_chapters": 2,
        "chapters": [
            {"chapter_number": 1, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
        ],
        "circuit_breaker_events": [],
    }), encoding="utf-8")

    mgr.start(ManagedStartConfig())
    executor = AsyncStage4Executor(projects_dir)
    result = await executor.execute(_make_archival_item(chapter=1), project_id=pid)

    # Normal path: not the stopped branch.
    assert result["status"] == "ok"
    assert result["advanced"] is True
    # progress.json was bumped to chapter 2.
    progress = json.loads((projects_dir / pid / "progress.json").read_text())
    assert progress["current_chapter"] == 2
    # Next chapter's write_scene was enqueued.
    kinds = [q.kind for q in mgr.load().queue]
    assert "write_scene" in kinds


# ---------------------------------------------------------------------------
# Test 4: mgr.stop() called twice in a row is a no-op (idempotency contract)
# ---------------------------------------------------------------------------

def test_mgr_stop_twice_in_a_row_is_noop(mgr, projects_dir, pid):
    """Explicit red-test of the manager-level idempotency that the executor
    relies on. Mirrors test_autopilot_session_persistence.py but in the
    test_executor_* file for locality with the executor tests."""
    mgr.start(ManagedStartConfig())
    s1 = mgr.stop()
    assert s1.state == SessionState.STOPPED
    s2 = mgr.stop()  # second stop — must not raise
    assert s2.state == SessionState.STOPPED
    completes = [e for e in mgr.load().history if e.type == "task_complete"]
    assert len(completes) == 1  # only the first stop emitted an event
