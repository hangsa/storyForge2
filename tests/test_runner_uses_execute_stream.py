"""Verify the runner prefers execute_stream() when the executor implements it,
and falls back to execute() when it does not (preserves compatibility with the
existing FakeStage4Executor used elsewhere).
"""

import asyncio
from pathlib import Path
from types import SimpleNamespace
import pytest

from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
from backend.conductor import stage4_async_executor as ex_mod
from backend.models.autopilot_session import ManagedStartConfig, QueueItem, SessionState
from backend.utils.sse_broadcaster import SSEBroadcaster


class StreamCapableExecutor:
    def __init__(self):
        self.execute_called = 0
        self.execute_stream_called = 0

    async def execute(self, item, project_id):
        self.execute_called += 1
        return {"status": "ok", "scene_status": "completed"}

    async def execute_stream(self, item, project_id):
        self.execute_stream_called += 1
        return {"status": "ok", "scene_status": "completed"}


class ExecuteOnlyExecutor:
    def __init__(self):
        self.execute_called = 0

    async def execute(self, item, project_id):
        self.execute_called += 1
        return {"status": "ok", "scene_status": "completed"}


def _bootstrap_session(projects_dir: Path, project_id: str):
    from backend.conductor.autopilot_session import AutopilotSessionManager
    mgr = AutopilotSessionManager(projects_dir, project_id)
    mgr.start(ManagedStartConfig())
    mgr.add_queue(QueueItem(
        id="w-1", kind="write_scene", chapter_number=1,
        scheduled_at=None, priority=20,
        payload={"scene_number": 1},
    ))
    return mgr


def test_runner_prefers_execute_stream_when_implemented(tmp_path):
    proj_id = "proj_runner_stream"
    pd = tmp_path / proj_id
    pd.mkdir()
    (pd / "project.json").write_text(
        '{"project_id": "proj_runner_stream", "stage": "STAGE4"}',
        encoding="utf-8",
    )

    mgr = _bootstrap_session(tmp_path, proj_id)
    ex = StreamCapableExecutor()
    runner = AsyncAutopilotRunner(mgr, ex, cadence="balanced")  # type: ignore[arg-type]

    async def _go():
        await runner._step_one(mgr.load().queue[0], project_id=proj_id)
    asyncio.run(_go())

    assert ex.execute_stream_called == 1
    assert ex.execute_called == 0


def test_runner_falls_back_to_execute_when_no_stream(tmp_path):
    proj_id = "proj_runner_no_stream"
    pd = tmp_path / proj_id
    pd.mkdir()
    (pd / "project.json").write_text(
        '{"project_id": "proj_runner_no_stream", "stage": "STAGE4"}',
        encoding="utf-8",
    )

    mgr = _bootstrap_session(tmp_path, proj_id)
    ex = ExecuteOnlyExecutor()
    runner = AsyncAutopilotRunner(mgr, ex, cadence="balanced")  # type: ignore[arg-type]

    async def _go():
        await runner._step_one(mgr.load().queue[0], project_id=proj_id)
    asyncio.run(_go())

    assert ex.execute_called == 1