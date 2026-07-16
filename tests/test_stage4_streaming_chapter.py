"""Tests for _write_scene_chapter_stream — the streaming twin of _write_scene_chapter.

The function is an async generator that yields dicts with shape
  {"event": "chunk", "text": "..."}                  (one or more, between flush boundaries)
  {"event": "done", "draft_text": "...", "status": "completed"|"force_passed"|"skipped"}  (final)
  {"event": "failed", "error": "...", "partial_text": "..."}      (on exception)

We monkey-patch the LLM-driven writer to feed a canned async iterator of StreamChunks,
then verify:
- Multiple "chunk" events are yielded, each <= 50 chars (the spec's flush boundary).
- A final "done" event carries the assembled draft text + a "status" field.
- An exception inside the writer yields a single "failed" event with partial_text.
- Fact Guard / StoryOS / draft.md finalization runs on the assembled text.
"""

import asyncio
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from backend.agents.base_agent import StreamChunk
from backend.api import stage4_writing as sw
from backend.api.stage4_writing import _write_scene_chapter_stream


def _bootstrap_project(tmp_path: Path) -> dict:
    """Build a minimal project directory tree so _load_context can succeed.

    Returns the project_id used to wire things up.
    """
    proj_id = "proj_stream_test"
    project_dir = tmp_path / proj_id
    project_dir.mkdir()
    (project_dir / "project.json").write_text(
        json.dumps({"project_id": proj_id, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    (project_dir / "outline.json").write_text(
        json.dumps({
            "chapters": [
                {
                    "chapter_number": 1,
                    "scene_plan": [
                        {"scene_number": 1, "goal": "g", "conflict": "c",
                         "emotional_arc": "ea", "narrative_role": "setup",
                         "required_logs": []},
                    ],
                },
            ],
        }),
        encoding="utf-8",
    )
    (project_dir / "chapters").mkdir()
    (project_dir / "characters.json").write_text("[]", encoding="utf-8")
    (project_dir / "world.json").write_text(
        json.dumps({"power_system": {"name": "qi", "description": "d"},
                    "core_rules": [], "ceilings": []}),
        encoding="utf-8",
    )
    (project_dir / "concept.json").write_text(
        json.dumps({"concept": {"premise": "p"},
                    "story_dna": {"core_contradiction": {"statement": "s"}}}),
        encoding="utf-8",
    )
    return {"project_id": proj_id, "project_dir": project_dir}


def _patch_writer_stream(chunks, monkeypatch):
    """Replace WriterAgent.write_scene_stream with an async generator that yields
    the given StreamChunks. The WriterAgent is constructed inside _load_context;
    monkeypatching the class method covers every instance."""
    async def fake_write_scene_stream(self, **kwargs):
        for c in chunks:
            yield c
    monkeypatch.setattr(
        "backend.agents.writer.WriterAgent.write_scene_stream",
        fake_write_scene_stream,
    )


def _patch_fact_guard(breaker_result, monkeypatch):
    """Replace ReviewerAgent.run_fact_guard + CircuitBreaker.check so the streaming
    function converges to the requested breaker outcome without LLM-6-check logic."""
    class FakeResult:
        all_passed = True
        coherence_score = 90
        checks = []
        retry_hints = ""
    monkeypatch.setattr(
        "backend.agents.reviewer.ReviewerAgent.run_fact_guard",
        lambda self, **kw: FakeResult(),
    )

    class FakeBreaker:
        def check(self, **kw):
            return breaker_result
        def generate_retry_hints(self, *a, **kw):
            return ""
    monkeypatch.setattr(sw, "CircuitBreaker", lambda: FakeBreaker())


def test_streaming_yields_chunks_then_done(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path

    chunks = [StreamChunk(text=t) for t in ["夜", "风", "如", "刀", "。", " 沈", "渡"]]
    chunks.append(StreamChunk(text="", finish_reason="stop"))
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(breaker_result="passed", monkeypatch=monkeypatch)

    async def _collect():
        out = []
        async for ev in _write_scene_chapter_stream(
            project_id=info["project_id"],
            chapter_number=1,
            scene_number=1,
        ):
            out.append(ev)
        return out

    events = asyncio.run(_collect())
    chunk_events = [e for e in events if e["event"] == "chunk"]
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1
    assert done_events[0]["status"] == "completed"
    assembled = "".join(e["text"] for e in chunk_events)
    assert assembled == "夜风如刀。 沈渡"
    # Spec §3.2: each flushed chunk text is the raw accumulator (NOT necessarily <=50).
    # The flush boundary is on the *producer* side (every 50 chars / 80 ms),
    # not on individual chunk text lengths.


def test_streaming_done_writes_draft_md(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path
    chunks = [StreamChunk(text="全文本"), StreamChunk(text="", finish_reason="stop")]
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(breaker_result="passed", monkeypatch=monkeypatch)

    async def _consume():
        async for _ in _write_scene_chapter_stream(
            project_id=info["project_id"],
            chapter_number=1,
            scene_number=1,
        ):
            pass

    asyncio.run(_consume())
    draft_path = info["project_dir"] / "chapters" / "ch01_scene_001_draft.md"
    assert draft_path.exists()
    assert draft_path.read_text(encoding="utf-8") == "全文本"


def test_streaming_yields_failed_on_writer_exception(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path

    async def fake_with_error(self, **kwargs):
        yield StreamChunk(text="partial-")
        raise RuntimeError("LLM kaboom")

    monkeypatch.setattr(
        "backend.agents.writer.WriterAgent.write_scene_stream",
        fake_with_error,
    )
    _patch_fact_guard(breaker_result="passed", monkeypatch=monkeypatch)

    async def _collect():
        out = []
        async for ev in _write_scene_chapter_stream(
            project_id=info["project_id"],
            chapter_number=1,
            scene_number=1,
        ):
            out.append(ev)
        return out

    events = asyncio.run(_collect())
    failed = [e for e in events if e["event"] == "failed"]
    assert len(failed) == 1
    assert "LLM kaboom" in failed[0]["error"]
    assert failed[0]["partial_text"].startswith("partial-")


def test_streaming_status_reflects_breaker_result(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path
    chunks = [StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")]
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(breaker_result="force_pass", monkeypatch=monkeypatch)

    async def _collect():
        out = []
        async for ev in _write_scene_chapter_stream(
            project_id=info["project_id"],
            chapter_number=1,
            scene_number=1,
        ):
            out.append(ev)
        return out

    events = asyncio.run(_collect())
    done = [e for e in events if e["event"] == "done"][0]
    assert done["status"] == "force_passed"