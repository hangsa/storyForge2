"""Async executors for the AutopilotRunner queue.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md
§§3, 4. Two implementations of `AsyncTaskExecutor`:
  - AsyncStage4Executor: production. Calls real stage4 helpers in-process.
  - FakeStage4Executor: test seam. Same control flow, but with canned
    draft_factory / breaker_result / advance_should_raise so tests run
    without an LLM key.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional

from backend.models.autopilot_session import QueueItem, SessionState

from backend.api.stage4_writing import (
    OutlineExhaustedError,
    _normalize_scene_text,
    _write_scene_chapter, _write_scene_chapter_stream, _advance_chapter,
)
from backend.conductor.autopilot_runner_async import (
    archive_priority,
    is_chapter_complete,
    scene_priority,
)


def _read_outline(projects_dir: Path, project_id: str) -> dict:
    p = projects_dir / project_id / "outline.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_progress(projects_dir: Path, project_id: str) -> dict:
    p = projects_dir / project_id / "progress.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _next_outline_chapter(outline: dict, chapter_number: int) -> Optional[dict]:
    return next(
        (c for c in outline.get("chapters", [])
         if c.get("chapter_number") == chapter_number),
        None,
    )


def _scene_in_outline(
    projects_dir: Path, project_id: str, chapter_number: int, scene_number: int
) -> bool:
    """True iff outline.json has a `scene_plan` entry with `scene_number`
    for the given chapter. The outline can be modified by the user (or by
    the wizard's regenerate button) while an autopilot session is in
    flight — the session's queue may then reference scenes the outline
    no longer contains. Without this precheck, _write_scene_chapter raises
    HTTPException(SCENE_NOT_FOUND) and the runner's retry-then-pause loop
    burns 3 attempts on a deterministic failure. Found and fixed
    2026-07-27 on proj_bb0375eb where outline.json was overwritten at
    16:00:33 (LLM non-determinism regenerated chapter 10 with 3 scenes
    instead of 4), leaving write-10-4 stranded in the queue.
    """
    outline = _read_outline(projects_dir, project_id)
    chapter = _next_outline_chapter(outline, chapter_number)
    if not chapter:
        return False
    return any(
        s.get("scene_number") == scene_number
        for s in chapter.get("scene_plan", [])
    )


# Map raw breaker_result → canonical scene status used by DONE_STATUSES
# ("completed" / "force_passed" / "skipped") and the runner's
# `scene_status == "force_passed"` check. This is the executor's
# boundary: callers see the canonical form regardless of where the
# raw value came from (test seam, real breaker, etc.).
_BREAKER_TO_SCENE_STATUS = {
    "passed": "completed",
    "force_pass": "force_passed",
    "skipped": "skipped",
}


def _canonical_scene_status(raw: str) -> str:
    return _BREAKER_TO_SCENE_STATUS.get(raw, raw)


def _write_scene_progress(
    projects_dir: Path,
    project_id: str,
    chapter_number: int,
    scene_number: int,
    breaker_result: str,
    attempt: int = 1,
    coherence_score: int = 100,
) -> None:
    """Append/upsert a scene_progress entry on progress.json after a scene
    write completes. Mirrors the bookkeeping _write_scene_chapter() does at
    the end of its non-streaming path; the streaming twin intentionally
    leaves this to the executor (per the contract documented in
    stage4_writing.py:845-850 — "executor owns the cross-file bookkeeping").

    Without this, the runner's `seed_queue()` keeps re-adding the same
    unfinished scenes to the queue because progress.json never marks them
    completed — and after the queue appears to drain (because the runner
    drops each item after a streaming write that didn't persist), the
    autopilot session auto-stops with no work to show for it. Found and
    fixed 2026-07-17 after proj_cc4ca4ae produced completed chapter streams
    but never advanced past current_chapter=21.
    """
    from backend.utils.file_manager import FileManager
    fm = FileManager(projects_dir)
    progress = fm.read_json(project_id, "progress.json") or {}
    progress.setdefault("project_id", project_id)
    progress.setdefault("current_chapter", chapter_number)
    progress.setdefault("chapters", [])

    chapter_progress = next(
        (ch for ch in progress["chapters"]
         if ch.get("chapter_number") == chapter_number),
        None,
    )
    if chapter_progress is None:
        chapter_progress = {
            "chapter_number": chapter_number,
            "status": "in_progress",
            "scenes": [],
        }
        progress["chapters"].append(chapter_progress)

    scene_progress = next(
        (s for s in chapter_progress.get("scenes", [])
         if s.get("scene_number") == scene_number),
        None,
    )
    if scene_progress is None:
        chapter_progress.setdefault("scenes", []).append({
            "scene_number": scene_number,
            "status": "completed" if breaker_result == "passed" else breaker_result,
            "retry_count": attempt - 1,
            "coherence_score": coherence_score,
        })
    fm.write_json(project_id, "progress.json", progress)


def _add_queue_if_absent(mgr, item: QueueItem) -> bool:
    current = mgr.load()
    if current is not None and any(queued.id == item.id for queued in current.queue):
        return False
    mgr.add_queue(item)
    return True


def _maybe_enqueue_archival(
    mgr, projects_dir: Path, project_id: str, chapter_number: int
) -> bool:
    """If the given chapter is now complete (per is_chapter_complete), enqueue
    an archival item after the chapter's last scene and before the next
    chapter's first scene. Returns True if enqueued. Used by both executors
    to keep the post-write control flow in one place."""
    progress = _read_progress(projects_dir, project_id)
    outline = _read_outline(projects_dir, project_id)
    ch_p = next(
        (c for c in progress.get("chapters", [])
         if c.get("chapter_number") == chapter_number),
        None,
    )
    ch_o = next(
        (c for c in outline.get("chapters", [])
         if c.get("chapter_number") == chapter_number),
        None,
    )
    if ch_p and ch_o and is_chapter_complete(
        ch_p.get("scenes", []), ch_o.get("scene_plan", []),
    ):
        return _add_queue_if_absent(mgr, QueueItem(
            id=f"archive-{chapter_number}",
            kind="archival",
            chapter_number=chapter_number,
            scheduled_at=None,
            priority=archive_priority(chapter_number),
            payload={},
        ))
    return False


class AsyncStage4Executor:
    """Production executor. Real LLM calls; no test seams.

    The executor is stateless w.r.t. the manager — it builds a fresh
    `AutopilotSessionManager` per `execute()` call from `projects_dir` +
    `project_id`. This means lifespan can construct ONE executor at app
    startup and use it for every project (no per-request executor wiring).
    """

    def __init__(self, projects_dir: Path, broadcaster: Optional[Any] = None) -> None:
        """Constructor.

        `broadcaster` is optional: if omitted, a default SSEBroadcaster is
        used (publishes are silently dropped when no subscribers). Production
        code (the FastAPI lifespan) passes the module-level broadcaster from
        backend.api.autopilot; tests can inject a fresh broadcaster to assert
        on published events.
        """
        self._projects_dir = Path(projects_dir)
        if broadcaster is None:
            from backend.utils.sse_broadcaster import SSEBroadcaster
            broadcaster = SSEBroadcaster()  # silently drops events (no subscribers)
        self._broadcaster = broadcaster

    def _mgr_for(self, project_id: str):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        return AutopilotSessionManager(self._projects_dir, project_id)

    async def execute(self, item: QueueItem, project_id: str) -> dict:
        if item.kind == "write_scene":
            return await self._write_scene(item, project_id)
        if item.kind == "archival":
            return await self._archival(item, project_id)
        raise ValueError(f"AsyncStage4Executor: unsupported kind {item.kind!r}")

    async def execute_stream(self, item: QueueItem, project_id: str) -> dict:
        """Streaming twin of execute(). Returns the same shape so the runner can
        treat both calls interchangeably."""
        if item.kind == "write_scene":
            return await self._write_scene_stream(item, project_id)
        # archival / other kinds still use the non-streaming path.
        return await self.execute(item, project_id)

    async def _write_scene(self, item: QueueItem, project_id: str) -> dict:
        scene = item.payload["scene_number"]
        if not _scene_in_outline(
            self._projects_dir, project_id, item.chapter_number, scene
        ):
            # Outline drift: the chapter's scene_plan no longer contains this
            # scene number (user edited the outline or ran regenerate). Don't
            # burn an LLM call; signal the runner so it can drop the queue
            # item without entering the retry loop.
            return {
                "status": "scene_missing",
                "error": (
                    f"Scene {scene} 不存在（大纲已被修改，chapter {item.chapter_number} "
                    "的 scene_plan 中已无此 scene）"
                ),
            }
        result = await _write_scene_chapter(
            project_id=project_id,
            chapter_number=item.chapter_number,
            scene_number=scene,
        )
        mgr = self._mgr_for(project_id)
        _maybe_enqueue_archival(mgr, self._projects_dir, project_id,
                               item.chapter_number)
        return {"status": "ok", "scene_status": _canonical_scene_status(
            result["detail"]["status"]
        )}

    async def _write_scene_stream(self, item: QueueItem, project_id: str) -> dict:
        """Per-task streaming writer. Constructs a SceneChunkStore, fires
        scene_start, consumes _write_scene_chapter_stream() events, persists
        each chunk, publishes scene_chunk / scene_done / scene_failed.

        Order on success (spec §3.3, §4.3.2):
          1. chunk_store.clear()   — wipe any leftover from a previous scene
          2. broadcaster.publish("scene_start", {...})
          3. For each "chunk" event:
                chunk_store.append(text)
                broadcaster.publish("scene_chunk", {...})
          4. On "done":
                broadcaster.publish("scene_done", {...})
                chunk_store.clear()
                _maybe_enqueue_archival(...)
          5. On "failed":
                broadcaster.publish("scene_failed", {...})
                chunk_store.clear()
                return {"status": "fail", ...}
        """
        from backend.conductor.scene_chunk_store import SceneChunkStore

        chapter = item.chapter_number
        scene = item.payload["scene_number"]
        if not _scene_in_outline(
            self._projects_dir, project_id, chapter, scene
        ):
            # Outline drift. Publish scene_failed so the cockpit clears any
            # stale UI for this scene, then return scene_missing so the
            # runner drops the queue item without retrying or pausing.
            self._broadcaster.publish("scene_failed", {
                "chapter_number": chapter,
                "scene_number": scene,
                "error": (
                    f"Scene {scene} 不存在（大纲已被修改，chapter {chapter} "
                    "的 scene_plan 中已无此 scene）"
                ),
                "partial_text": "",
            })
            return {
                "status": "scene_missing",
                "error": (
                    f"Scene {scene} 不存在（大纲已被修改，chapter {chapter} "
                    "的 scene_plan 中已无此 scene）"
                ),
            }
        chunk_store = SceneChunkStore(
            self._projects_dir, project_id, chapter, scene,
        )
        chunk_store.clear()  # hygiene: stale data from a prior aborted scene

        self._broadcaster.publish("scene_start", {
            "chapter_number": chapter,
            "scene_number": scene,
        })

        mgr = self._mgr_for(project_id)

        try:
            async for event in _write_scene_chapter_stream(
                project_id=project_id,
                chapter_number=chapter,
                scene_number=scene,
            ):
                if event["event"] == "chunk":
                    # Strip reasoning-model artifacts (think-block + JSON
                    # wrapper leftovers) BEFORE storing and publishing, so
                    # the cockpit live stream AND the SceneChunkStore replay
                    # both see clean prose. See _normalize_scene_text's
                    # docstring for why this matters — the per-chunk pass
                    # handles early-arriving think blocks; the post-stream
                    # pass at the end handles the complete JSON wrapper.
                    raw = event["text"]
                    normalized = _normalize_scene_text(raw)
                    # Skip the chunk entirely if normalization empties it
                    # (e.g. a chunk that was 100% think-block content).
                    if not normalized:
                        continue
                    record = chunk_store.append(normalized)
                    self._broadcaster.publish("scene_chunk", {
                        "seq": record.seq,
                        "chapter_number": record.chapter_number,
                        "scene_number": record.scene_number,
                        "text": record.text,
                    })
                elif event["event"] == "done":
                    self._broadcaster.publish("scene_done", {
                        "chapter_number": chapter,
                        "scene_number": scene,
                        "status": event.get("status", "completed"),
                        "total_chars": len(event.get("draft_text", "")),
                    })
                    chunk_store.clear()  # draft.md is the new source-of-truth
                    # Persist progress.json for the completed scene — see
                    # _write_scene_progress() docstring for why this is here
                    # rather than inside _write_scene_chapter_stream().
                    _write_scene_progress(
                        self._projects_dir, project_id, chapter, scene,
                        breaker_result=event.get("status", "passed"),
                        attempt=event.get("attempt", 1),
                    )
                    _maybe_enqueue_archival(
                        mgr, self._projects_dir, project_id, chapter,
                    )
                    return {
                        "status": "ok",
                        "scene_status": _canonical_scene_status(event.get("status", "passed")),
                    }
                elif event["event"] == "failed":
                    self._broadcaster.publish("scene_failed", {
                        "chapter_number": chapter,
                        "scene_number": scene,
                        "error": event.get("error", ""),
                        "partial_text": event.get("partial_text", ""),
                    })
                    chunk_store.clear()
                    return {"status": "fail", "error": event.get("error", "")}
        except Exception as e:
            self._broadcaster.publish("scene_failed", {
                "chapter_number": chapter,
                "scene_number": scene,
                "error": str(e),
                "partial_text": "",
            })
            chunk_store.clear()
            return {"status": "fail", "error": str(e)}
        return {"status": "fail", "error": "no_done_event"}

    async def _archival(self, item: QueueItem, project_id: str) -> dict:
        mgr = self._mgr_for(project_id)
        try:
            await _advance_chapter(project_id=project_id)
        except OutlineExhaustedError as exc:
            # T1: _advance_chapter raises when current_chapter has reached the
            # outline's max. The HTTP wrapper translates this to 400, but inside
            # the autopilot loop we want a clean exit: stop the session and
            # surface a structured status so the runner's main loop sees an
            # empty queue on its next iteration and exits.
            current = mgr.load()
            if current is not None and current.state == SessionState.RUNNING:
                mgr.stop(reason="outline_exhausted")
            else:
                # Already stopped — still record the reason on the session
                # so the UI can explain why nothing further is happening.
                mgr.stop(reason="outline_exhausted")
            return {
                "status": "stopped",
                "reason": "outline_exhausted",
                "current_chapter": exc.current_chapter,
                "outline_max": exc.outline_max,
            }
        progress = _read_progress(self._projects_dir, project_id)
        outline = _read_outline(self._projects_dir, project_id)
        next_ch = progress.get("current_chapter", item.chapter_number + 1)
        next_ch_entry = _next_outline_chapter(outline, next_ch)
        if next_ch_entry is None:
            return {"status": "ok", "advanced": True, "next": None}
        for s in next_ch_entry.get("scene_plan", []):
            _add_queue_if_absent(mgr, QueueItem(
                id=f"write-{next_ch}-{s['scene_number']}",
                kind="write_scene",
                chapter_number=next_ch,
                scheduled_at=None,
                priority=scene_priority(next_ch, s["scene_number"]),
                payload={"scene_number": s["scene_number"]},
            ))
        return {"status": "ok", "advanced": True, "next": next_ch}


class FakeStage4Executor:
    """Test executor. Mirrors AsyncStage4Executor's control flow but uses
    canned values. Real MemoryCoordinator / StoryOSAgent / CheckpointManager /
    progress.json writes still happen because we route through _write_scene_chapter
    with the test seams set."""

    def __init__(
        self,
        mgr,
        projects_dir: Path,
        *,
        draft_factory: Optional[Callable[[int, int], str]] = None,
        breaker_result: str = "passed",
        advance_should_raise: Optional[BaseException] = None,
    ) -> None:
        self._mgr = mgr
        self._projects_dir = Path(projects_dir)
        self._draft_factory = draft_factory or (lambda c, s: f"<draft ch={c} scene={s} />")
        self._breaker_result = breaker_result
        self._advance_should_raise = advance_should_raise
        self._calls: list = []

    async def execute(self, item: QueueItem, project_id: str) -> dict:
        if item.kind == "write_scene":
            scene = item.payload["scene_number"]
            if not _scene_in_outline(
                self._projects_dir, project_id, item.chapter_number, scene
            ):
                return {
                    "status": "scene_missing",
                    "error": (
                        f"Scene {scene} 不存在（大纲已被修改，chapter {item.chapter_number} "
                        "的 scene_plan 中已无此 scene）"
                    ),
                }
            self._calls.append({"kind": "write_scene", "chapter": item.chapter_number,
                                "scene": scene})
            result = await _write_scene_chapter(
                project_id=project_id,
                chapter_number=item.chapter_number,
                scene_number=scene,
                draft_factory=self._draft_factory,
                breaker_result_override=self._breaker_result,
            )
            _maybe_enqueue_archival(self._mgr, self._projects_dir, project_id,
                                   item.chapter_number)
            return {"status": "ok", "scene_status": _canonical_scene_status(
                result["detail"]["status"]
            )}

        if item.kind == "archival":
            self._calls.append({"kind": "archival", "chapter": item.chapter_number})
            if self._advance_should_raise is not None:
                raise self._advance_should_raise
            await _advance_chapter(project_id=project_id, fake=True)
            progress = _read_progress(self._projects_dir, project_id)
            outline = _read_outline(self._projects_dir, project_id)
            next_ch = progress.get("current_chapter", item.chapter_number + 1)
            next_ch_entry = _next_outline_chapter(outline, next_ch)
            if next_ch_entry is None:
                return {"status": "ok", "advanced": True, "next": None}
            for s in next_ch_entry.get("scene_plan", []):
                _add_queue_if_absent(self._mgr, QueueItem(
                    id=f"write-{next_ch}-{s['scene_number']}",
                    kind="write_scene",
                    chapter_number=next_ch,
                    scheduled_at=None,
                    priority=scene_priority(next_ch, s["scene_number"]),
                    payload={"scene_number": s["scene_number"]},
                ))
            return {"status": "ok", "advanced": True, "next": next_ch}

        raise ValueError(f"FakeStage4Executor: unsupported kind {item.kind!r}")