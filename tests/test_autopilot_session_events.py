"""End-to-end SSE contract for /autopilot/session/events.

Spawns a real uvicorn server (httpx.ASGITransport buffers until the body
iterator finishes, which would deadlock the long-poll). The SSEBroadcaster
is shared across the test app and the publisher coroutine so we can
deterministically emit events.
"""
import asyncio
import json
from pathlib import Path

import pytest
import pytest_asyncio
import httpx
import uvicorn
from fastapi import FastAPI

from backend.config import settings
from backend.utils.sse_broadcaster import SSEBroadcaster


@pytest.fixture
def broadcaster() -> SSEBroadcaster:
    return SSEBroadcaster(history_size=64, queue_max=16)


@pytest.fixture
def temp_projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    return tmp_path


@pytest_asyncio.fixture
async def server_url(broadcaster, temp_projects_dir, monkeypatch):
    """Boot uvicorn in a task; yield the base URL. Stop on teardown."""
    from backend.api import autopilot

    monkeypatch.setattr(autopilot, "broadcaster", broadcaster, raising=False)
    app = FastAPI()
    app.include_router(autopilot.router)

    config = uvicorn.Config(
        app, host="127.0.0.1", port=0, log_level="warning",
        loop="asyncio",
    )
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None  # pytest's loop
    task = asyncio.create_task(server.serve())
    # Wait for startup
    for _ in range(50):
        if server.started:
            break
        await asyncio.sleep(0.1)
    assert server.started, "uvicorn did not start in time"
    port = server.servers[0].sockets[0].getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    try:
        yield base_url, broadcaster
    finally:
        server.should_exit = True
        await task


def _write_session(dir: Path, project_id: str, payload: dict) -> None:
    proj = dir / project_id
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "project.json").write_text(json.dumps({"id": project_id}), encoding="utf-8")
    (proj / "autopilot").mkdir(parents=True, exist_ok=True)
    (proj / "autopilot" / "session.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def _parse_sse(raw: bytes) -> list:
    out = []
    for block in raw.decode("utf-8").split("\n\n"):
        ev: dict = {"data_parts": []}
        if not block.strip():
            continue
        for line in block.splitlines():
            if line.startswith(":"):
                continue
            if ":" not in line:
                continue
            k, _, v = line.partition(":")
            v = v.lstrip()
            if k == "id":
                try:
                    ev["id"] = int(v)
                except ValueError:
                    pass
            elif k == "event":
                ev["event"] = v
            elif k == "data":
                ev["data_parts"].append(v)
        if ev.get("data_parts"):
            ev["data"] = "\n".join(ev["data_parts"])
            ev.pop("data_parts", None)
        if ev:
            out.append(ev)
    return out


@pytest.mark.asyncio
async def test_streaming_response_sends_snapshot_then_published_events(
    server_url, temp_projects_dir
):
    base_url, bc = server_url
    pid = "p_test"
    _write_session(temp_projects_dir, pid, {
        "project_id": pid,
        "state": "running",
        "current_task": {"description": "writing chapter 1"},
        "queue": [],
        "history": [],
        "config": {},
    })

    async with httpx.AsyncClient(base_url=base_url, timeout=10) as client:
        async with client.stream(
            "GET",
            f"/api/v1/projects/{pid}/autopilot/session/events",
            headers={"Last-Event-ID": "0"},
        ) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")

            async def publish_after_delay():
                await asyncio.sleep(0.1)
                bc.publish("task_complete", {"chapter": 1})
                bc.publish("circuit_open", {"reason": "test"})

            asyncio.create_task(publish_after_delay())
            chunks = []
            async for chunk in resp.aiter_bytes():
                chunks.append(chunk)
                if len(chunks) >= 3:
                    break

    raw = b"".join(chunks)
    events = _parse_sse(raw)
    assert events[0]["event"] == "snapshot"
    snap = json.loads(events[0]["data"])
    assert snap["state"] == "running"
    assert events[1]["event"] == "task_complete"
    assert json.loads(events[1]["data"]) == {"chapter": 1}
    assert "id" in events[1]
    assert events[2]["event"] == "circuit_open"


@pytest.mark.asyncio
async def test_last_event_id_replays_from_history(server_url, temp_projects_dir):
    base_url, bc = server_url
    pid = "p_history"
    _write_session(temp_projects_dir, pid, {
        "project_id": pid, "state": "stopped",
        "current_task": None, "queue": [], "history": [], "config": {},
    })
    bc.publish("decision", {"text": "go"})
    last_id = bc.publish("task_start", {"chapter": 1})

    async with httpx.AsyncClient(base_url=base_url, timeout=10) as client:
        async with client.stream(
            "GET",
            f"/api/v1/projects/{pid}/autopilot/session/events",
            headers={"Last-Event-ID": str(last_id - 1)},
        ) as resp:
            chunks = []
            async for chunk in resp.aiter_bytes():
                chunks.append(chunk)
                if len(chunks) >= 2:
                    break
    raw = b"".join(chunks)
    events = _parse_sse(raw)
    names = [e.get("event") for e in events]
    assert "snapshot" in names
    assert "task_start" in names
    assert "decision" not in names


@pytest.mark.asyncio
async def test_404_when_project_missing(server_url):
    base_url, _ = server_url
    async with httpx.AsyncClient(base_url=base_url, timeout=5) as client:
        resp = await client.get(
            "/api/v1/projects/missing_project/autopilot/session/events"
        )
        assert resp.status_code == 404