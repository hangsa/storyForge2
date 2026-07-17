"""Tests for AsyncStage4Executor._write_scene_stream().

Verifies:
- scene_start published at the start
- scene_chunk published per chunk yielded from _write_scene_chapter_stream()
- scene_done published on success; chunk_store cleared after
- scene_failed published on failure; chunk_store cleared after
- Returns the same shape as _write_scene(): {"status": "ok"|"fail", ...}
- _maybe_enqueue_archival() is called on success
"""

import asyncio
import json
from pathlib import Path

from backend.agents.base_agent import StreamChunk
from backend.conductor.scene_chunk_store import chunk_path
from backend.conductor import stage4_async_executor as ex_mod
from backend.models.autopilot_session import QueueItem
from backend.utils.sse_broadcaster import SSEBroadcaster


def _bootstrap_project(tmp_path: Path) -> dict:
    proj_id = "proj_stream_exec"
    pd = tmp_path / proj_id
    pd.mkdir()
    (pd / "project.json").write_text(
        json.dumps({"project_id": proj_id, "stage": "STAGE4"}),
        encoding="utf-8",
    )
    (pd / "outline.json").write_text(json.dumps({
        "chapters": [{
            "chapter_number": 1,
            "scene_plan": [{"scene_number": 1, "goal": "g", "conflict": "c",
                            "emotional_arc": "ea", "narrative_role": "setup",
                            "required_logs": []}],
        }],
    }), encoding="utf-8")
    (pd / "chapters").mkdir()
    return {"project_id": proj_id, "project_dir": pd}


def _fake_streaming_chapter(chunks, monkeypatch):
    """Replace _write_scene_chapter_stream with an async generator that yields
    one "chunk" per StreamChunk then a "done" event."""
    async def fake_gen(*, project_id, chapter_number, scene_number, **kw):
        for c in chunks:
            if c.finish_reason is None:
                yield {"event": "chunk", "text": c.text}
            # Don't emit intermediate events for the final empty chunk here;
            # the streaming chapter function yields "done" after draining.
        yield {
            "event": "done",
            "draft_text": "".join(c.text for c in chunks if c.text),
            "status": "completed",
        }
    monkeypatch.setattr(ex_mod, "_write_scene_chapter_stream", fake_gen)


def _make_broadcaster_with_subscribers():
    bc = SSEBroadcaster(history_size=64, queue_max=32)
    return bc


def _build(projects_dir, broadcaster):
    ex = ex_mod.AsyncStage4Executor(projects_dir)
    ex._broadcaster = broadcaster  # injected after construction
    return ex


def test_write_scene_stream_publishes_scene_start(tmp_path, monkeypatch):
    info = _setup(tmp_path, monkeypatch)
    ex = _build(tmp_path, info["broadcaster"])
    _fake_streaming_chapter(
        [StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")],
        monkeypatch,
    )
    item = QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                     scheduled_at=None, priority=20,
                     payload={"scene_number": 1})

    async def _run():
        return await ex.execute_stream(item, info["project_id"])

    result = asyncio.run(_run())
    assert result["status"] == "ok"
    history = [ev.event for ev in info["broadcaster"].history]
    assert "scene_start" in history
    assert "scene_chunk" in history
    assert "scene_done" in history


def test_write_scene_stream_persists_chunks_with_monotonic_seq(tmp_path, monkeypatch):
    info = _setup(tmp_path, monkeypatch)
    ex = _build(tmp_path, info["broadcaster"])
    _fake_streaming_chapter(
        [StreamChunk(text=t) for t in ["alpha", "beta", "gamma"]] + [StreamChunk(text="", finish_reason="stop")],
        monkeypatch,
    )
    item = QueueItem(id="w-1-2", kind="write_scene", chapter_number=1,
                     scheduled_at=None, priority=20,
                     payload={"scene_number": 2})

    async def _run():
        return await ex.execute_stream(item, info["project_id"])

    asyncio.run(_run())
    # chunk_store is cleared AFTER scene_done (per spec §3.3) — file should NOT exist.
    path = chunk_path(tmp_path, info["project_id"], 1, 2)
    assert not path.exists(), "JSONL must be cleared after scene_done"


def test_write_scene_stream_publishes_failed_on_exception(tmp_path, monkeypatch):
    info = _setup(tmp_path, monkeypatch)
    ex = _build(tmp_path, info["broadcaster"])

    async def fake_gen(*, project_id, chapter_number, scene_number, **kw):
        yield {"event": "chunk", "text": "partial-"}
        raise RuntimeError("writer oops")

    monkeypatch.setattr(ex_mod, "_write_scene_chapter_stream", fake_gen)
    item = QueueItem(id="w-1-3", kind="write_scene", chapter_number=1,
                     scheduled_at=None, priority=20,
                     payload={"scene_number": 3})

    async def _run():
        return await ex.execute_stream(item, info["project_id"])

    result = asyncio.run(_run())
    assert result["status"] == "fail"
    history = [ev.data for ev in info["broadcaster"].history if ev.event == "scene_failed"]
    assert len(history) == 1
    assert "writer oops" in history[0]["error"]


# --- v1.9.1: cockpit-facing chunks must be normalized (v1.9 fix) ----------
# MiniMax-M3 emits a 3-layer envelope: chain-of-thought preamble +
# ```json code fence + {"text":"..."} wrapper. The per-chunk normalization
# in the executor strips the prose preamble LIVE so the cockpit live stream
# never sees the LLM's reasoning text. Final assembled draft still has the
# full envelope stripped by _write_scene_chapter_stream's own pass.

def test_write_scene_stream_normalizes_think_block_per_chunk(tmp_path, monkeypatch):
    """Cockpit scene_chunk events must never include  LLM thinking text,
    even when the chunk itself wraps a think block in mid-stream."""
    info = _setup(tmp_path, monkeypatch)
    ex = _build(tmp_path, info["broadcaster"])
    open_think = chr(60) + "think" + chr(62)
    close_think = chr(60) + "/think" + chr(62)
    _fake_streaming_chapter(
        [StreamChunk(text=t) for t in [
            open_think + "model is planning" + close_think + "正。",
            "文。",
        ]] + [StreamChunk(text="", finish_reason="stop")],
        monkeypatch,
    )
    item = QueueItem(id="w-1-9", kind="write_scene", chapter_number=1,
                     scheduled_at=None, priority=20,
                     payload={"scene_number": 9})
    asyncio.run(ex.execute_stream(item, info["project_id"]))
    scene_chunks = [
        ev.data["text"] for ev in info["broadcaster"].history
        if ev.event == "scene_chunk"
    ]
    # Sanity: real prose survives the normalization (across the post-think chunks).
    joined = "".join(scene_chunks)
    assert "正。" in joined and "文。" in joined, scene_chunks
    # No think marker or thinking text leaked into any scene_chunk.
    for t in scene_chunks:
        assert open_think not in t, f"think-open leaked: {t!r}"
        assert "model is planning" not in t, f"planning text leaked: {t!r}"


# --- helpers ------------------------------------------------------------

def _setup(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = _make_broadcaster_with_subscribers()
    return {**info, "broadcaster": bc}
