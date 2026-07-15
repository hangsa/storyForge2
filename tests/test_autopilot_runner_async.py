"""Unit tests for the pure helpers and async runner/executor that drive
the AutopilotSession queue. Spec: docs/superpowers/specs/2026-07-14-...
§§3-5 (file structure + 6-rule failure table)."""
from __future__ import annotations
import pytest

from backend.conductor.autopilot_runner_async import is_chapter_complete


def _scene(scene_number: int, status: str = "completed") -> dict:
    return {"scene_number": scene_number, "status": status}


def _plan(*scene_numbers: int) -> list:
    return [{"scene_number": n, "goal": "", "conflict": ""} for n in scene_numbers]


class TestIsChapterComplete:
    """Spec §5 rows 5, 6, 7 + edge cases. 8 cases."""

    def test_full_match_all_completed(self):
        assert is_chapter_complete(
            [_scene(1), _scene(2), _scene(3)],
            _plan(1, 2, 3),
        ) is True

    def test_partial_progress_returns_false(self):
        """Row 5: progress.scenes.length < outline.scene_plan.length."""
        assert is_chapter_complete(
            [_scene(1)], _plan(1, 2, 3),
        ) is False

    def test_progress_longer_than_outline_returns_true(self):
        """Row 6: outline was shortened mid-run; ignore extras."""
        assert is_chapter_complete(
            [_scene(1), _scene(2), _scene(3), _scene(99, "completed")],
            _plan(1, 2, 3),
        ) is True

    def test_zombie_in_progress_returns_false(self):
        """Row 7: last session crashed mid-write; treat as not-yet-done."""
        assert is_chapter_complete(
            [_scene(1), _scene(2, "in_progress")], _plan(1, 2),
        ) is False

    def test_force_passed_counts_as_done(self):
        assert is_chapter_complete(
            [_scene(1, "force_passed"), _scene(2)], _plan(1, 2),
        ) is True

    def test_skipped_counts_as_done(self):
        assert is_chapter_complete(
            [_scene(1, "skipped"), _scene(2)], _plan(1, 2),
        ) is True

    def test_empty_outline_returns_true(self):
        """Edge case: no scenes planned → trivially complete."""
        assert is_chapter_complete([], []) is True

    def test_outline_present_but_progress_empty_returns_false(self):
        assert is_chapter_complete([], _plan(1)) is False


from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor.autopilot_runner_async import seed_queue
from backend.models.autopilot_session import ManagedStartConfig, QueueItem


@pytest.fixture
def projects_dir(tmp_path, monkeypatch):
    import json
    from backend.config import settings
    from backend.api.stage4_writing import fm
    # _write_scene_chapter / _advance_chapter use settings.projects_dir (and the
    # module-level fm.projects_dir bound at import time). Bind both to tmp_path
    # so the executor's file I/O lands in the test's sandbox.
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    fm.projects_dir = tmp_path
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(
        json.dumps({"id": "p1"}), encoding="utf-8"
    )
    return tmp_path


@pytest.fixture
def mgr(projects_dir):
    return AutopilotSessionManager(projects_dir, "p1")


def _write_outline(projects_dir, outline: dict) -> None:
    import json
    (projects_dir / "p1" / "outline.json").write_text(
        json.dumps(outline), encoding="utf-8"
    )


def _write_progress(projects_dir, progress: dict) -> None:
    import json
    (projects_dir / "p1" / "progress.json").write_text(
        json.dumps(progress), encoding="utf-8"
    )


class TestSeedQueue:
    """Spec §4A + §2 row 2. seed_queue is pure: takes inputs, returns count.
    It writes to the manager as a side effect (QueueItems land in mgr.queue)
    so callers can introspect via mgr.load().queue."""

    def test_all_planned_with_no_progress_enqueues_all_scenes(
        self, mgr, projects_dir
    ):
        _write_outline(projects_dir, {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]})
        from backend.conductor.autopilot_runner_async import seed_queue
        n = seed_queue(
            mgr, outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
                ]},
                {"chapter_number": 2, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2},
                ]},
            ]},
            progress=None, novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n == 5  # 3 + 2
        s = mgr.load()
        assert len(s.queue) == 5
        # add_queue sorts by priority. Priority = 20 + scene_number, so
        # ch1s1(21)/ch2s1(21)/ch1s2(22)/ch2s2(22)/ch1s3(23).
        nums = [q.payload["scene_number"] for q in s.queue
                if q.kind == "write_scene"]
        chapters = [q.chapter_number for q in s.queue if q.kind == "write_scene"]
        assert chapters == [1, 2, 1, 2, 1]
        assert nums == [1, 1, 2, 2, 3]
        # Priorities match: 20 + scene_number (sorted ascending by add_queue).
        assert [q.priority for q in s.queue if q.kind == "write_scene"] == [21, 21, 22, 22, 23]

    def test_all_planned_skips_completed_scenes(self, mgr, projects_dir):
        """Spec §5 row 5: progress shorter than outline; only enqueue missing."""
        _write_outline(projects_dir, {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]})
        n = seed_queue(
            mgr,
            outline={"chapters": [{"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]}]},
            progress={"current_chapter": 1, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n == 2  # scenes 2 and 3 only
        nums = [q.payload["scene_number"] for q in mgr.load().queue]
        assert nums == [2, 3]

    def test_next_chapter_scope_only_enqueues_current(self, mgr):
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": []},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="next_chapter"),
        )
        assert n == 1
        assert mgr.load().queue[0].chapter_number == 2

    def test_chapter_fully_done_is_skipped(self, mgr):
        """Spec §5 row 6: progress longer than outline → ignore extras; full
        chapter means no new items enqueued for it."""
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n == 0

    def test_zombie_scene_is_re_enqueued(self, mgr):
        """Spec §5 row 7: in_progress scene is treated as not yet done."""
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 1, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "in_progress"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n == 1

    def test_returns_zero_when_nothing_to_do(self, mgr):
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n == 0


import json
from pathlib import Path


@pytest.fixture
def fake_project(projects_dir: Path):
    """A minimal project with outline + progress suitable for AsyncStage4Executor."""
    proj = projects_dir / "p1"
    # _write_scene_chapter and _advance_chapter need these files. The bare
    # outline.json + progress.json from the plan are insufficient.
    (proj / "project.json").write_text(json.dumps({
        "id": "p1", "title": "测试", "current_stage": "STAGE4",
        "genre": "cool_novel",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({"title": "X"}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1, "goal": "g1", "conflict": "c1"},
                {"scene_number": 2, "goal": "g2", "conflict": "c2"},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1, "goal": "g3", "conflict": "c3"},
            ]},
        ],
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps({
        "project_id": "p1", "current_stage": "STAGE4",
        "current_chapter": 1, "total_chapters": 2,
        "chapters": [
            {"chapter_number": 1, "status": "in_progress", "scenes": []},
            {"chapter_number": 2, "status": "pending", "scenes": []},
        ], "circuit_breaker_events": [],
    }), encoding="utf-8")
    return "p1"


class TestFakeStage4Executor:
    @pytest.mark.asyncio
    async def test_write_scene_writes_draft_and_updates_progress(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<draft ch={c} scene={s} />",
            breaker_result="passed",
        )
        result = await executor.execute(
            QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        # Draft file written
        draft = (projects_dir / "p1" / "chapters" / "ch01_scene_001_draft.md").read_text()
        assert draft == "<draft ch=1 scene=1 />"
        # Progress.json updated
        progress = json.loads(
            (projects_dir / "p1" / "progress.json").read_text()
        )
        ch1 = next(c for c in progress["chapters"] if c["chapter_number"] == 1)
        assert any(s["status"] == "completed" for s in ch1["scenes"])

    @pytest.mark.asyncio
    async def test_write_scene_emits_archival_after_last_scene(
        self, mgr, projects_dir, fake_project
    ):
        """When this write_scene completes the chapter, an archival item lands in queue."""
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<d {c}-{s}>",
            breaker_result="passed",
        )
        # Write both scenes of chapter 1.
        await executor.execute(
            QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        await executor.execute(
            QueueItem(id="w-1-2", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=22,
                      payload={"scene_number": 2}),
            project_id="p1",
        )
        archival = [q for q in mgr.load().queue if q.kind == "archival"]
        assert len(archival) == 1
        assert archival[0].chapter_number == 1
        assert archival[0].priority == 10  # ahead of next chapter's write_scene

    @pytest.mark.asyncio
    async def test_archival_advances_and_seeds_next_chapter(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        # Mark chapter 1 scenes as completed so _advance_chapter's precondition passes.
        prog_path = projects_dir / "p1" / "progress.json"
        prog = json.loads(prog_path.read_text(encoding="utf-8"))
        prog["chapters"][0]["scenes"] = [
            {"scene_number": 1, "status": "completed"},
            {"scene_number": 2, "status": "completed"},
        ]
        prog_path.write_text(json.dumps(prog), encoding="utf-8")

        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<d {c}-{s}>",
            breaker_result="passed",
        )
        result = await executor.execute(
            QueueItem(id="a-1", kind="archival", chapter_number=1,
                      scheduled_at=None, priority=10, payload={}),
            project_id="p1",
        )
        assert result["advanced"] is True
        # progress.current_chapter bumped to 2; next chapter's scene seeded.
        progress = json.loads(
            (projects_dir / "p1" / "progress.json").read_text()
        )
        assert progress["current_chapter"] == 2
        kinds = [q.kind for q in mgr.load().queue]
        assert "write_scene" in kinds

    @pytest.mark.asyncio
    async def test_archival_failure_raises_so_runner_pauses(
        self, mgr, projects_dir, fake_project
    ):
        """Spec §5 row 4: SummaryArchiver raises → executor propagates."""
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        # Mark chapter 1 scenes as completed so _advance_chapter's precondition passes.
        prog_path = projects_dir / "p1" / "progress.json"
        prog = json.loads(prog_path.read_text(encoding="utf-8"))
        prog["chapters"][0]["scenes"] = [
            {"scene_number": 1, "status": "completed"},
            {"scene_number": 2, "status": "completed"},
        ]
        prog_path.write_text(json.dumps(prog), encoding="utf-8")

        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: "ok",
            breaker_result="passed",
            advance_should_raise=RuntimeError("summary failed"),
        )
        with pytest.raises(RuntimeError, match="summary failed"):
            await executor.execute(
                QueueItem(id="a-1", kind="archival", chapter_number=1,
                          scheduled_at=None, priority=10, payload={}),
                project_id="p1",
            )

    @pytest.mark.asyncio
    async def test_unsupported_kind_raises_value_error(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(mgr, projects_dir)
        with pytest.raises(ValueError, match="unsupported kind"):
            await executor.execute(
                QueueItem(id="x", kind="plan_chapter", chapter_number=1,
                          scheduled_at=None, priority=1, payload={}),
                project_id="p1",
            )


class TestAsyncStage4ExecutorControlFlow:
    """Light control-flow tests for the production executor. They patch the
    extracted helpers so we don't need an LLM key. Production routing is
    verified end-to-end in Task 12 (integration tests)."""

    @pytest.mark.asyncio
    async def test_routes_write_scene_through_extracted_helper(
        self, monkeypatch, projects_dir
    ):
        from backend.conductor import stage4_async_executor as mod
        from backend.conductor.stage4_async_executor import AsyncStage4Executor

        async def fake_write_scene_chapter(**kwargs):
            # Return the same shape _write_scene_chapter returns.
            return {"error": False, "code": "OK", "message": "",
                    "detail": {"status": "ok"}}

        monkeypatch.setattr(mod, "_write_scene_chapter", fake_write_scene_chapter)

        executor = AsyncStage4Executor(projects_dir)
        result = await executor.execute(
            QueueItem(id="w-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        assert result["scene_status"] == "ok"

    @pytest.mark.asyncio
    async def test_routes_archival_through_extracted_helper(
        self, monkeypatch, projects_dir, fake_project
    ):
        from backend.conductor import stage4_async_executor as mod
        from backend.conductor.stage4_async_executor import AsyncStage4Executor

        async def fake_advance_chapter(**kwargs):
            # Mimic the real shape so the executor's progress read sees a
            # bumped current_chapter.
            import json as _json
            prog_path = projects_dir / "p1" / "progress.json"
            prog = _json.loads(prog_path.read_text(encoding="utf-8"))
            prog["current_chapter"] = prog.get("current_chapter", 1) + 1
            prog_path.write_text(_json.dumps(prog), encoding="utf-8")
            return {"error": False, "code": "OK", "message": "",
                    "detail": {"status": "advanced"}}

        monkeypatch.setattr(mod, "_advance_chapter", fake_advance_chapter)

        executor = AsyncStage4Executor(projects_dir)
        result = await executor.execute(
            QueueItem(id="a-1", kind="archival", chapter_number=1,
                      scheduled_at=None, priority=10, payload={}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        assert result["advanced"] is True

    @pytest.mark.asyncio
    async def test_unsupported_kind_raises_value_error(
        self, projects_dir
    ):
        from backend.conductor.stage4_async_executor import AsyncStage4Executor
        executor = AsyncStage4Executor(projects_dir)
        with pytest.raises(ValueError, match="unsupported kind"):
            await executor.execute(
                QueueItem(id="x", kind="plan_chapter", chapter_number=1,
                          scheduled_at=None, priority=1, payload={}),
                project_id="p1",
            )