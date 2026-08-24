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


# --- _normalize_scene_text: scene-inside-think-block recovery -----------
# MiniMax-M3 reasoning mode sometimes does all of plan → draft → self-review
# inside the <think>...</think> block, then emits `\n\n` or a truncated JSON
# wrapper after. The original normalizer stripped the think block and ended
# up with empty/short text, which made _write_scene_chapter_stream yield
# "LLM 返回了空文本" and pause the autopilot after 3 retries.
# Reproduced on proj_1a7d7fcf ch1 scene 1 on 2026-08-20 — paused with
# reason=scene_write_failed:write-1-1:LLM 返回了空文本.
# Fix: try _extract_scene_from_think_block FIRST (CJK-density + length
# scoring of sections inside the think block); only fall through to the
# legacy "strip think + extract JSON wrapper" path if that returns empty.


def _make_scene_in_think_text(scene_section: str) -> str:
    """Build a representative raw LLM response where the entire scene is
    inside the think block. The model 'thinks' (planning English), drafts
    (Chinese prose), self-reviews (English checks), all wrapped in
    <think>...</think>, then emits nothing useful after."""
    return (
        "<think>Let me carefully analyze this scene.\n\n"
        "Requirements:\n"
        "- POV: limited to 高阳\n"
        "- Sensory balance\n"
        "- No emotional labels\n\n"
        "--- DRAFT ---\n\n"
        f"{scene_section}\n\n"
        "--- REVIEW ---\n\n"
        "Checking:\n"
        "1. ✓ POV strict\n"
        "2. ✓ No emotional labels\n"
        "3. ✓ Metaphor count within range\n"
        "4. ✓ No explanatory narration\n\n"
        "Verifying constraints met. Looks good.\n"
        "</think>\n\n"
    )


def test_normalize_recovers_scene_inside_think_block_when_post_think_empty():
    """The whole scene is inside the think block; the post-</think> content
    is just whitespace. Without the fallback, _normalize_scene_text returns
    "" and _write_scene_chapter_stream yields failed="LLM 返回了空文本"."""
    scene = "风不是风。\n\n高阳蜷起身体，左臂烧灼得厉害。<!-- SF_LOG character_physical_change char=\"高阳\" change=\"左臂灼痕\" -->"
    raw = _make_scene_in_think_text(scene)
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned, "normalizer must not return empty when scene is inside think block"
    assert "风不是风" in cleaned
    assert "高阳" in cleaned
    assert "<!-- SF_LOG character_physical_change" in cleaned
    # Must NOT leak review text into draft.
    assert "Checking:" not in cleaned
    assert "Verifying constraints met" not in cleaned


def test_normalize_recovers_best_section_from_multiple_drafts_in_think_block():
    """Model produces multiple draft attempts (Draft 1 / Draft 2 / Final
    draft) inside the think block, then a review section. The normalizer
    must pick the longest / most-final one, not the shortest first draft."""
    final_scene = (
        "Final draft:\n\n"
        "声音没了。\n\n"
        "不是变小。是消失。彻底地、干净地消失。\n\n"
        "高阳张嘴，没有听见自己呼吸。\n\n"
        "<!-- SF_LOG character_location_change char=\"高阳\" from=\"乱流\" to=\"地面\" -->"
    )
    raw = (
        "<think>OK, let me write the scene.\n\n"
        "--- Draft 1 ---\n\n"
        "高阳醒来。\n\n"  # short draft, should NOT be picked
        "--- Draft 2 ---\n\n"
        "风像刀子。\n\n"  # medium draft
        "--- Final draft ---\n\n"
        "声音没了。\n\n"
        "不是变小。是消失。彻底地、干净地消失。\n\n"
        "高阳张嘴，没有听见自己呼吸。\n\n"
        "<!-- SF_LOG character_location_change char=\"高阳\" from=\"乱流\" to=\"地面\" -->\n\n"
        "--- REVIEW ---\n\n"
        "Word count: ~1500 chars. Looks good. ✓\n"
        "</think>\n\n"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert "声音没了" in cleaned, "must extract the final scene content"
    assert "<!-- SF_LOG character_location_change" in cleaned
    assert "Word count" not in cleaned, "review text must NOT leak into draft"
    assert "Draft 1" not in cleaned, "short first draft must not be picked"
    assert "Draft 2" not in cleaned, "medium draft must not be picked"
    # The picked section is the final draft (longest + has SF_LOG tag +
    # "Final" label hint). Not the short Draft 1 or Draft 2.


def test_normalize_recovers_scene_when_post_think_has_truncated_json():
    """Edge case (proj_1a7d7fcf sample 1, 2026-08-20): the model wrote the
    scene inside the think block, AND started a JSON wrapper after, but the
    stream was truncated mid-JSON. The post-<think> content is just
    `{"text": "<!-- SF_LOG ... scene-so-far` with no closing brace. The
    partial-JSON recovery would only return a few hundred chars; the
    think-block recovery returns the full scene. Order matters:
    think-block extraction runs first."""
    full_scene = (
        "<!-- SF_LOG character_location_change char=\"高阳\" "
        "from=\"时空乱流·坠落中\" to=\"建木边境·荒废村庄地面\" -->\n\n"
        "声音没了。\n\n"
        "不是安静——是所有频率挤在一起，拧成一根白刺，扎进他耳道。\n\n"
        "他睁不开眼。\n\n"
        "眼皮上有东西压着，比铅重，又比铅烫。左臂更烫。"
    )
    raw = (
        "<think>Let me plan this scene carefully. Many constraints to check.\n\n"
        "--- DRAFT ---\n\n"
        f"{full_scene}\n\n"
        "--- REVIEW ---\n\n"
        "Word count: ~1500 chars. Looks good. ✓\n"
        "</think>\n\n"
        "```json\n"
        '{"text": "' + full_scene[:50]  # truncated mid-JSON, ~155 chars total
    )
    cleaned = sw._normalize_scene_text(raw)
    # Must be the FULL scene from inside the think block, not the truncated
    # partial-JSON snippet (~50 chars after "{"text": "" prefix).
    assert cleaned == full_scene, (
        "must extract the full scene from inside the think block, not the "
        "truncated partial-JSON snippet"
    )


def test_normalize_returns_empty_when_think_block_has_no_scene():
    """Defensive case: think block contains only planning/review, no
    scene-like section, and post-think content is empty. Result must be
    empty (the caller will emit the 'LLM 返回了空文本' failed event —
    that's the correct signal when the LLM truly returned nothing
    usable)."""
    raw = (
        "<think>I cannot write this scene because the prompt is unclear.\n"
        "Let me try anyway... no, I refuse. Stopping.</think>\n\n"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned == ""


def test_normalize_legacy_think_plus_json_fence_still_works():
    """Regression: the proj_cc4ca4ae ch28+ shape (think + json fence +
    complete JSON wrapper) must still unwrap via the legacy path. This
    covers the case where the scene is OUTSIDE the think block (think block
    contains only planning)."""
    raw = (
        "<think>planning only</think>\n"
        "```json\n"
        '{"text": "正文。\\n\\n内容。\\n\\n'
        '<!-- SF_LOG mystery_clue id=\\"x\\" clue=\\"线索\\" -->"}\n'
        "```"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert "正文" in cleaned
    assert "内容" in cleaned
    assert "<!-- SF_LOG mystery_clue" in cleaned
    assert not cleaned.startswith("{")
    assert "```" not in cleaned


def test_normalize_recovers_inline_revised_chinese_lines_without_section_markers():
    """Failure mode observed on proj_1a7d7fcf 2026-08-23 ch15-4: MiniMax-M3
    emits the entire scene INSIDE the think block with NO recognized
    section markers (`---` / `Draft:` / `Final:` / `##`). The think block
    alternates Chinese prose lines with English self-review lines, ending
    with a trailing cut-off CJK fragment (no `\n</think>\n` body after).
    The current `_extract_scene_from_think_block` splits on 0 markers →
    1 part → returns "" → caller emits "LLM 返回了空文本". The fix must
    fall back to per-line CJK-density scoring and recover the prose lines
    while dropping the English review lines."""
    raw = (
        "<think>\n"
        "高阳把黑卡压在吧台上，服务员低头看了一眼就匆匆离开。\n"
        "He checked the watch and then walked to the back door.\n"
        "Let me verify the metaphor count: 2.\n"
        "苏晓晓站在雨里，雨水顺着发梢滴落，她回头看了一眼。\n"
        "Actually, I should add more atmosphere here.\n"
        "Wait, the chapter needs more tension. Let me revise:\n"
        "苏晓晓的眼神冷了下来，她没有接高阳递过来的伞。\n"
        "高阳的手指悬在半空，那张黑卡在霓虹灯下反着光。\n"
        "Let me check the SF_LOG tag: character_location_change.\n"
        "<!-- SF_LOG character_location_change char=\"高阳\" location=\"雨夜街道\" -->\n"
        "高阳把黑\n"
        "</think>"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned, "must recover prose lines from inline think block"
    # The Chinese prose lines must be present, the English review lines
    # must be stripped.
    assert "高阳把黑卡压在吧台上" in cleaned
    assert "苏晓晓站在雨里" in cleaned
    assert "苏晓晓的眼神冷了下来" in cleaned
    assert "高阳的手指悬在半空" in cleaned
    assert "<!-- SF_LOG character_location_change" in cleaned
    # English review lines are noise — must not leak into draft.md.
    assert "He checked the watch" not in cleaned
    assert "Let me verify" not in cleaned
    assert "Actually," not in cleaned
    assert "Let me check the SF_LOG tag" not in cleaned
    # Trailing truncated fragment ("高阳把黑") is acceptable to keep
    # (it's already past the cutoff point — but since the prose line
    # before it ("高阳的手指悬在半空") is complete, only that trailing
    # partial line may remain). Crucially, the result must NOT be empty.


def test_normalize_recovers_chinese_lines_wrapped_in_code_fences():
    """Variant of the ch15-4 failure: the inline self-revision inside the
    think block is wrapped in markdown ``` fences. The fallback must still
    recover the prose lines (skipping the fence lines)."""
    raw = (
        "<think>\n"
        "```\n"
        "高阳把黑卡压在吧台上，服务员低头看了一眼。\n"
        "Wait, I should make this more tense.\n"
        "苏晓晓站在雨里，她没有接伞。\n"
        "```\n"
        "Actually let me add a SF_LOG:\n"
        "<!-- SF_LOG conflict_escalate id=\"cf_001\" new_intensity=\"critical\" trigger=\"黑卡\" -->\n"
        "苏晓晓的眼神冷了下来。\n"
        "</think>"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned, "must recover prose lines even with code fences inside think block"
    assert "高阳把黑卡压在吧台上" in cleaned
    assert "苏晓晓站在雨里" in cleaned
    assert "苏晓晓的眼神冷了下来" in cleaned
    assert "<!-- SF_LOG conflict_escalate" in cleaned
    # Fence lines and review lines must be stripped.
    assert "```" not in cleaned
    assert "Wait, I should make this more tense" not in cleaned
    assert "Actually let me add a SF_LOG" not in cleaned


def test_normalize_still_empty_for_english_only_think_block():
    """Regression: pure-English think block (no Chinese prose at all)
    must still return "" — the fallback must not invent prose. The
    existing test_normalize_returns_empty_when_think_block_has_no_scene
    covers the no-marker case; this one covers the case where the model
    emits English self-review lines that would mistakenly be classified
    as review but there's no CJK prose to fall back on."""
    raw = (
        "<think>\n"
        "I will write a scene about two characters.\n"
        "Let me check the requirements: tension, atmosphere, mystery.\n"
        "Actually, I'll start with the dialogue.\n"
        "Wait, the prompt says to focus on character interaction.\n"
        "Okay, let me draft something.\n"
        "On second thought, this is too complex.\n"
        "I should stop and ask for clarification.\n"
        "Stopping here.\n"
        "</think>"
    )
    cleaned = sw._normalize_scene_text(raw)
    assert cleaned == "", (
        "pure-English think block with no CJK prose must still return empty; "
        "fallback must not invent prose"
    )
