"""Tests for GET /api/v1/projects/{id}/autopilot/chapter-stream.

Uses fastapi TestClient with a fake broadcaster so we can publish events to
subscribers synchronously from the test, and verify the SSE bytes stream out
in the right format.
"""

import asyncio
import json
import time
from pathlib import Path
from typing import List
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import autopilot as ap_api
from backend.config import settings
from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.utils.sse_broadcaster import SSEBroadcaster


def _bootstrap_session(tmp_path: Path, project_id: str, current_task_kind: str = "write_scene"):
    pd = tmp_path / project_id
    pd.mkdir()
    (pd / "project.json").write_text(
        json.dumps({"project_id": project_id, "stage": "STAGE4"}),
        encoding="utf-8",
    )
    mgr = AutopilotSessionManager(tmp_path, project_id)
    mgr.ensure_idle_session()
    s = mgr.load()
    if current_task_kind:
        from backend.models.autopilot_session import CurrentTask
        mgr.set_current_task(CurrentTask(
            kind=current_task_kind,
            chapter_number=1,
            scene_id="1-1",
            status="active",
            started_at=None,
            description="writing",
            progress_pct=0,
        ))
    (pd / "autopilot").mkdir(exist_ok=True)
    return pd


def _make_app_with_broadcaster(broadcaster):
    app = FastAPI()
    app.include_router(ap_api.router)
    # Inject a loop_service and stage4_executor so the start-session path is
    # safe to call but NOT exercised by these tests (we never POST).
    app.state.loop_service = None  # type: ignore[assignment]
    app.state.stage4_executor = None  # type: ignore[assignment]
    # Monkey-patch the module-level broadcaster so this app uses ours.
    ap_api.broadcaster = broadcaster
    return app


def _read_events(body_iter, want=1, timeout=2.0) -> List[str]:
    """Consume `want` SSE event blocks from the test client. Each event block
    is terminated by a blank line; we stop after want blocks to keep tests fast."""
    out: List[str] = []
    buf = ""
    started = time.time()
    for chunk in body_iter:
        if isinstance(chunk, bytes):
            chunk = chunk.decode("utf-8")
        buf += chunk
        # Each SSE event ends with two newlines (blank line separator).
        while "\n\n" in buf and len(out) < want + 2:  # slack for heartbeats
            block, buf = buf.split("\n\n", 1)
            if block.strip():
                out.append(block)
        if len(out) >= want:
            break
        if time.time() - started > timeout:
            break
    return out


def test_endpoint_returns_404_json_when_project_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    app = _make_app_with_broadcaster(bc)
    client = TestClient(app)

    resp = client.get("/api/v1/projects/nope/autopilot/chapter-stream")
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "PROJECT_NOT_FOUND"


def test_endpoint_emits_idle_when_no_session(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    app = _make_app_with_broadcaster(bc)
    client = TestClient(app)

    # Project exists, but session.json absent.
    pd = tmp_path / "proj_no_session"
    pd.mkdir()
    (pd / "project.json").write_text(
        json.dumps({"project_id": "proj_no_session", "stage": "STAGE4"}),
        encoding="utf-8",
    )

    with client.stream("GET", "/api/v1/projects/proj_no_session/autopilot/chapter-stream") as resp:
        assert resp.status_code == 200
        blocks = _read_events(resp.iter_text(), want=1)
    idle = [b for b in blocks if '"no_active_write_scene"' in b or "idle" in b]
    assert idle, "expected an idle event"


def test_endpoint_emits_idle_when_current_task_not_write_scene(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    _bootstrap_session(tmp_path, "proj_archival", current_task_kind="archival")
    app = _make_app_with_broadcaster(bc)
    client = TestClient(app)

    with client.stream("GET", "/api/v1/projects/proj_archival/autopilot/chapter-stream") as resp:
        assert resp.status_code == 200
        blocks = _read_events(resp.iter_text(), want=1)
    assert any("idle" in b for b in blocks)


def test_endpoint_emits_scene_transition_when_current_task_changes_mid_stream(tmp_path, monkeypatch):
    """Bug 2026-07-17: after scene_done, the runner clears current_task to None
    (complete_current_task), then picks the next scene within ~10ms. During
    that gap the chapter-stream endpoint saw current_task != "write_scene"
    every 5s and emitted `idle` + closed the stream. The browser auto-
    reconnected but the next /chapter-stream call saw the same state and
    closed again — the cockpit stuck on the previous scene's text until the
    next scene_start finally arrived.

    New behavior: when current_task changes mid-stream, emit a
    `scene_transition` event but KEEP the stream open so the next
    scene_start flows through without the browser reconnecting.
    """
    import asyncio
    from fastapi.responses import StreamingResponse

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    _bootstrap_session(tmp_path, "proj_transition", current_task_kind="write_scene")

    # Re-bind the module-level broadcaster the endpoint reads.
    import backend.api.autopilot as ap_mod
    ap_mod.broadcaster = bc

    # Shrink the 5-second poll interval so the test runs fast.
    monkeypatch.setattr(ap_mod, "_CHAPTER_STREAM_TASK_CHECK_INTERVAL", 0.1)
    # Also shrink the broadcaster heartbeat so the subscribe loop iterates
    # quickly enough to run the poll check.
    from backend.utils import sse_broadcaster as sb_mod
    monkeypatch.setattr(sb_mod, "HEARTBEAT_INTERVAL", 0.05)

    # Now clear current_task so the check immediately fires scene_transition.
    mgr = AutopilotSessionManager(tmp_path, "proj_transition")
    s = mgr.load()
    if s and s.current_task:
        from backend.models.autopilot_session import complete_current_task
        mgr.save(complete_current_task(s))

    # The endpoint short-circuits to the one-shot idle stream when
    # current_task.kind != "write_scene" at connect time. To exercise the
    # MID-STREAM branch (current_task was write_scene at connect, then
    # changed), we re-set it just before driving the stream and clear it
    # again right after the connection opens.
    from backend.models.autopilot_session import CurrentTask
    mgr.set_current_task(CurrentTask(
        kind="write_scene", chapter_number=1, scene_id="1-1", status="active",
        started_at=None, description="x", progress_pct=0,
    ))

    from backend.api.autopilot import chapter_stream

    class _FakeReq:
        headers: dict = {}

    async def drive():
        response = await chapter_stream(
            project_id="proj_transition", request=_FakeReq(), last_event_id=None,
        )
        assert isinstance(response, StreamingResponse), f"got {type(response)}"

        # Clear current_task mid-stream so the next poll fires scene_transition.
        s = mgr.load()
        if s and s.current_task:
            from backend.models.autopilot_session import complete_current_task
            mgr.save(complete_current_task(s))

        body = response.body_iterator
        # Consume chunks until we see scene_transition (or hit the safety cap).
        deadline = asyncio.get_event_loop().time() + 3.0
        async for chunk in body:
            if b"scene_transition" in chunk:
                return chunk
            if b"idle" in chunk:
                return chunk  # failure mode
            if asyncio.get_event_loop().time() > deadline:
                return b"TIMEOUT"
        return b"EOF"

    chunk = asyncio.run(drive())
    assert b"scene_transition" in chunk, chunk[:500]
    assert b"current_task_changed" in chunk


def test_endpoint_replays_chunks_via_last_event_id(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    pd = _bootstrap_session(tmp_path, "proj_replay", current_task_kind="write_scene")

    # Pre-populate JSONL with two chunks so read_since() returns them.
    chunks_dir = pd / "autopilot" / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    (chunks_dir / "ch01_scene_001.jsonl").write_text(
        "\n".join([
            json.dumps({"seq": 1, "chapter_number": 1, "scene_number": 1,
                        "text": "夜风", "created_at": time.time()}),
            json.dumps({"seq": 2, "chapter_number": 1, "scene_number": 1,
                        "text": "如刀", "created_at": time.time()}),
        ]) + "\n",
        encoding="utf-8",
    )

    app = _make_app_with_broadcaster(bc)
    client = TestClient(app)

    # Last-Event-ID: 0 → replay all 2 chunks; the JSONL has no further chunks,
    # so the stream just closes after the replay (no live activity follows).
    headers = {"Last-Event-ID": "0"}
    with client.stream(
        "GET",
        "/api/v1/projects/proj_replay/autopilot/chapter-stream",
        headers=headers,
    ) as resp:
        assert resp.status_code == 200
        blocks = _read_events(resp.iter_text(), want=2)

    payloads = []
    for b in blocks:
        if "scene_chunk" in b:
            for line in b.splitlines():
                if line.startswith("data:"):
                    payloads.append(json.loads(line[len("data:"):].strip()))
    seqs = [p["seq"] for p in payloads if "seq" in p]
    assert seqs == [1, 2]


def test_endpoint_skips_chunks_older_than_last_event_id(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    bc = SSEBroadcaster()
    pd = _bootstrap_session(tmp_path, "proj_skip", current_task_kind="write_scene")
    chunks_dir = pd / "autopilot" / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    (chunks_dir / "ch01_scene_001.jsonl").write_text(
        "\n".join([
            json.dumps({"seq": 5, "chapter_number": 1, "scene_number": 1,
                        "text": "after", "created_at": time.time()}),
            json.dumps({"seq": 6, "chapter_number": 1, "scene_number": 1,
                        "text": "the-cut", "created_at": time.time()}),
        ]) + "\n",
        encoding="utf-8",
    )

    app = _make_app_with_broadcaster(bc)
    client = TestClient(app)

    headers = {"Last-Event-ID": "5"}  # already saw seq=5; need only seq=6
    with client.stream(
        "GET",
        "/api/v1/projects/proj_skip/autopilot/chapter-stream",
        headers=headers,
    ) as resp:
        blocks = _read_events(resp.iter_text(), want=1)
    payloads = []
    for b in blocks:
        if "scene_chunk" in b:
            for line in b.splitlines():
                if line.startswith("data:"):
                    payloads.append(json.loads(line[len("data:"):].strip()))
    seqs = [p["seq"] for p in payloads if "seq" in p]
    assert seqs == [6]