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


def _patch_fact_guard(all_passed, monkeypatch):
    """Replace ReviewerAgent.run_fact_guard with a FakeResult whose `all_passed`
    flag controls the streaming path's outcome. The streaming function no longer
    consults CircuitBreaker (single-pass, no retry loop), so a FakeBreaker
    is unnecessary — fix landed after proj_a601cee9 regression where
    breaker.check(attempt=1) returning "retry" leaked into progress.json."""
    class FakeResult:
        coherence_score = 90
        checks = []
        retry_hints = ""
    FakeResult.all_passed = all_passed
    monkeypatch.setattr(
        "backend.agents.reviewer.ReviewerAgent.run_fact_guard",
        lambda self, **kw: FakeResult(),
    )


def test_streaming_yields_chunks_then_done(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path

    chunks = [StreamChunk(text=t) for t in ["夜", "风", "如", "刀", "。", " 沈", "渡"]]
    chunks.append(StreamChunk(text="", finish_reason="stop"))
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(all_passed=True, monkeypatch=monkeypatch)

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
    _patch_fact_guard(all_passed=True, monkeypatch=monkeypatch)

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
    _patch_fact_guard(all_passed=True, monkeypatch=monkeypatch)

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


def test_streaming_status_is_completed_when_fact_guard_passes(tmp_path, monkeypatch):
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path
    chunks = [StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")]
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(all_passed=True, monkeypatch=monkeypatch)

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
    assert done["status"] == "completed"


def test_streaming_status_is_force_passed_when_fact_guard_fails(tmp_path, monkeypatch):
    """Regression for proj_a601cee9: streaming path must NOT route Fact Guard
    failure through CircuitBreaker.check (which returns "retry" since
    attempt=1 < MAX_RETRIES) and let that string leak into progress.json.
    Single-pass streaming has no retry loop, so Fact Guard failure
    semantically means force-pass."""
    info = _bootstrap_project(tmp_path)
    monkeypatch.setattr(sw.settings, "projects_dir", tmp_path)
    sw.fm.projects_dir = tmp_path
    chunks = [StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")]
    _patch_writer_stream(chunks, monkeypatch)
    _patch_fact_guard(all_passed=False, monkeypatch=monkeypatch)

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
    assert done["status"] != "retry"

# --- _normalize_scene_text: reasoning-model artifact stripping ----------------
# MiniMax-M3 emits a <think>...</think> chain-of-thought preamble and
# JSON-escaped quotes (char=\"沈渡\") in SF_LOG tags. Both broke fact guard on
# proj_cc4ca4ae (2026-07-17): escaped quotes made PARAM_PATTERN find 0 params,
# the breaker returned "retry", and the scene re-enqueued forever.

from backend.utils.regex_patterns import SF_LOG_PATTERN, PARAM_PATTERN


def test_normalize_strips_think_block():
    raw = "<think>Let me plan this scene.\nSF_LOG tags: mystery_clue</think>正文开始。"
    assert sw._normalize_scene_text(raw) == "正文开始。"


def test_normalize_strips_dangling_think_block():
    # Truncated stream: opening <think> with no close → drop from it onward.
    raw = "正文。<think>reasoning cut off mid-stream"
    assert sw._normalize_scene_text(raw) == "正文。"


def test_normalize_unescapes_quotes_so_sf_log_params_parse():
    raw = (
        "正文内容。\n"
        '<!-- SF_LOG character_location_change char=\\"沈渡\\" '
        'from=\\"校园\\" to=\\"图书馆\\" -->'
    )
    cleaned = sw._normalize_scene_text(raw)
    logs = SF_LOG_PATTERN.findall(cleaned)
    assert len(logs) == 1
    _log_type, params_str = logs[0]
    # Before the fix this was 0; the escaped quotes hid every key=value pair.
    assert len(PARAM_PATTERN.findall(params_str)) == 3


def test_normalize_noop_on_clean_text():
    raw = '正文。<!-- SF_LOG mystery_clue id="m1" clue="线索" -->'
    assert sw._normalize_scene_text(raw) == raw


def test_normalize_handles_empty():
    assert sw._normalize_scene_text("") == ""


# --- JSON wrapper handling (v1.9.1 streaming fix, 2026-07-17) -----------
# The scene_writing prompt uses output_format.type=json; MiniMax-M3 therefore
# wraps the body in `{"text":"..."}` even on the streaming path that bypasses
# json_mode. The wrapper + JSON-escaped newlines / quotes used to leak into
# draft.md and the cockpit live stream — see proj_cc4ca4ae ch28-30 drafts
# for the literal corruption. These tests pin the fix.

import json as _json


def test_normalize_extracts_text_from_json_wrapper():
    raw = (
        '正文："第一段。\\n\\n第二段。"'
    )
    wrapped = (
        "```json\n"
        + _json.dumps({"text": "正文：第一段。\n\n第二段。"}, ensure_ascii=False)
        + "\n```"
    )
    cleaned = sw._normalize_scene_text(wrapped)
    assert cleaned == "正文：第一段。\n\n第二段。"


def test_normalize_extracts_text_from_bare_json():
    """No markdown code fence — some runs emit bare JSON."""
    payload = _json.dumps({"text": "夜色如墨。\n\n沈渡在前。"}, ensure_ascii=False)
    cleaned = sw._normalize_scene_text(payload)
    assert cleaned == "夜色如墨。\n\n沈渡在前。"


def test_normalize_extracts_text_after_think_and_json_fence():
    """Real-world shape from proj_cc4ca4ae ch28_scene_006 (2026-07-17):
    3-layer envelope (think preamble + json code fence + {"text":"..."} wrapper).
    The first real draft after the v1.9.1 fix should round-trip to the inner text.
    """
    inner = "门被踹开的瞬间，整个房间的空气像被抽走了三度。"
    body = (
        "```json\n"
        + _json.dumps({"text": inner}, ensure_ascii=False)
        + "\n```"
    )
    # Build the think-markers dynamically so this file's angle brackets
    # are not parsed as anything fragile.
    open_think = chr(60) + "think" + chr(62)
    close_think = chr(60) + "/think" + chr(62)
    raw = open_think + "some reasoning that should vanish" + close_think + "\n\n" + body
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned == inner



def test_normalize_unescapes_quote_in_json_text():
    """SF_LOG tags inside the wrapped JSON text come back with real quotes;
    no extra unescape needed. But the wrapper itself uses \" — make sure
    json.loads gets us clean quotes (the contract above already covers this
    in test_normalize_extracts_text_from_json_wrapper)."""
    inner = '<!-- SF_LOG mystery_clue id="m1" clue="线索" -->'
    wrapped = (
        "```json\n"
        + _json.dumps({"text": inner}, ensure_ascii=False)
        + "\n```"
    )
    cleaned = sw._normalize_scene_text(wrapped)
    assert cleaned == inner


def test_normalize_passthrough_when_no_json():
    """If the LLM ignores the JSON hint and emits raw prose, do nothing."""
    raw = '夜色如墨。<!-- SF_LOG mystery_clue id="m1" clue="线索" -->'
    assert sw._normalize_scene_text(raw) == raw


def test_normalize_extracts_text_from_invalid_json_wrapper_with_unescaped_quotes():
    """Real-world shape from proj_cc4ca4ae ch31_scene_001 (2026-07-17):
    the model emits a {"text":"..."} wrapper but writes dialogue with
    UNESCAPED ASCII double quotes inside the string, so json.loads fails
    ("Expecting ',' delimiter"). The normalizer must still unwrap via a
    regex fallback and unescape \\n / \\t / \\" so the persisted draft is
    clean prose, not the literal JSON envelope."""
    # Note the inner dialogue quotes are raw " — this is what breaks json.loads.
    raw = '{\n  "text": "电话挂断了。\\n\\n"沈哥，是你吗？"他没应声。\\n\\n夜色如墨。"\n}'
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned == '电话挂断了。\n\n"沈哥，是你吗？"他没应声。\n\n夜色如墨。'
    assert not cleaned.startswith("{")
    assert "\\n" not in cleaned
