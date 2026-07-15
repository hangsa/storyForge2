"""AutopilotSessionManager — write-through persistence for AutopilotSession.

Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L284-287.
Invariants:
  - session.json writes are atomic (.tmp + Path.replace).
  - Every state transition persists BEFORE the manager returns.
  - session.json lives at <project_dir>/autopilot/session.json.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.models.autopilot_session import (
    AutopilotSession, CircuitSnapshot, CurrentTask, ManagedStartConfig,
    QueueItem, SessionEvent, SessionState, SessionStateMachine,
    add_queue_item, complete_current_task, drop_queue_item, set_current_task,
)

logger = logging.getLogger(__name__)


SESSION_FILENAME = "session.json"
SESSION_DIRNAME = "autopilot"


class AutopilotSessionManager:
    """Owns the on-disk file for one project's AutopilotSession."""

    def __init__(self, projects_dir: Path, project_id: str, broadcaster=None) -> None:
        self._projects_dir = Path(projects_dir)
        self._project_id = project_id
        self._session_dir = self._projects_dir / project_id / SESSION_DIRNAME
        self._session_file = self._session_dir / SESSION_FILENAME
        self._sm = SessionStateMachine()
        self._broadcaster = broadcaster
        # Number of history entries already published to the SSE broadcaster.
        # load() sets this to len(s.history) for sessions just loaded from disk
        # so subsequent saves don't re-broadcast old events. Starts at 0 for
        # fresh managers so the first write-through publishes its append.
        self._last_published_count: int = 0

    @property
    def session_path(self) -> Path:
        return self._session_file

    def _ensure_dir(self) -> None:
        self._session_dir.mkdir(parents=True, exist_ok=True)

    def _empty_session(self) -> AutopilotSession:
        return AutopilotSession(
            project_id=self._project_id, state=SessionState.IDLE,
            config=ManagedStartConfig(), started_at=None,
            last_heartbeat_at=None, current_task=None,
            queue=[], history=[], circuit=CircuitSnapshot(),
        )

    def load(self) -> Optional[AutopilotSession]:
        if not self._session_file.exists():
            return None
        try:
            raw = json.loads(self._session_file.read_text(encoding="utf-8"))
            s = _dict_to_session(raw)
            # Mark all loaded history as already-published so recover /
            # heartbeat flows don't re-broadcast old events on first save.
            self._last_published_count = len(s.history)
            return s
        except Exception as e:
            # Spec L286: corrupt file → treat as no session (don't crash server)
            logger.warning(
                "session.json unreadable for %s: %s — treating as no session",
                self._project_id, e,
            )
            return None

    def save(self, session: AutopilotSession) -> None:
        self._ensure_dir()
        tmp = self._session_file.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(_session_to_dict(session), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(self._session_file)
        # Publish only events appended since the last save. heartbeat() and
        # update_circuit_snapshot() rebuild and re-save the session without
        # appending to history; without this guard subscribers would see the
        # same tail event republished on every tick.
        new_events = session.history[self._last_published_count:]
        for event in new_events:
            self._publish_event(session, event)
        self._last_published_count = len(session.history)

    def _publish_event(self, s: AutopilotSession, event: "SessionEvent") -> None:
        """Push an event onto the SSE broadcaster. No-op if no broadcaster.

        Adds project_id to the published payload so subscribers can filter
        cross-project event bleed (the module-level SSEBroadcaster is shared
        across all projects). Failures of `asdict` are logged and swallowed
        so a malformed event can't break the persistence path.
        """
        if self._broadcaster is None:
            return
        try:
            data = asdict(event)
            data["project_id"] = s.project_id
        except Exception as e:
            logger.debug("autopilot SSE publish skipped for %s: %s",
                         self._project_id, e)
            return
        self._broadcaster.publish(event.type, data)

    # --- High-level intent methods (each writes through) ---

    def ensure_idle_session(self) -> AutopilotSession:
        s = self.load() or self._empty_session()
        if s.state == SessionState.IDLE:
            self.save(s)
        return s

    def start(self, cfg: ManagedStartConfig) -> AutopilotSession:
        s = self.load() or self._empty_session()
        if s.state == SessionState.RUNNING:
            return s  # idempotent
        s2 = self._sm.start(s, cfg=cfg)
        self.save(s2)
        return s2

    def stop(self) -> AutopilotSession:
        s = self.load() or self._empty_session()
        if s.state == SessionState.STOPPED:
            return s
        s2 = self._sm.stop(s)
        self.save(s2)
        return s2

    def pause(self) -> AutopilotSession:
        s = self.load() or self._empty_session()
        if s.state in (SessionState.PAUSED, SessionState.IDLE, SessionState.STOPPED):
            return s  # nothing to do
        s2 = self._sm.pause(s)
        self.save(s2)
        return s2

    def resume(self) -> AutopilotSession:
        s = self.load() or self._empty_session()
        if s.state != SessionState.PAUSED:
            return s
        s2 = self._sm.resume(s)
        self.save(s2)
        return s2

    def intervene(self, action: str) -> AutopilotSession:
        """Spec L275: action ∈ {"pause_immediate", "stop_current_task", "rollback_checkpoint"}.
        Stage 1 rollback is a stub. Stage 2 integrates with CheckpointManager.restore_registries_from_snapshot.
        """
        s = self.load() or self._empty_session()
        if action == "pause_immediate":
            return self.pause()
        if action == "stop_current_task":
            s2 = complete_current_task(s)
            self.save(s2)
            return s2
        if action == "rollback_checkpoint":
            return self.pause()  # Stage 1 stub
        raise ValueError(f"unknown intervention action: {action!r}")

    def set_current_task(self, task: CurrentTask) -> AutopilotSession:
        s = self.load() or self._empty_session()
        s2 = set_current_task(s, task)
        self.save(s2)
        return s2

    def fail_current_task(self, error: str) -> AutopilotSession:
        """Write-through wrapper for fail_current_task(error)."""
        from backend.models.autopilot_session import fail_current_task as _pure_fail
        s = self.load() or self._empty_session()
        s2 = _pure_fail(s, error=error)
        self.save(s2)
        return s2

    def complete_current_task(self) -> AutopilotSession:
        """Write-through wrapper for the pure `complete_current_task` helper."""
        from backend.models.autopilot_session import complete_current_task as _pure_complete
        s = self.load() or self._empty_session()
        s2 = _pure_complete(s)
        self.save(s2)
        return s2

    def add_queue(self, item: QueueItem) -> AutopilotSession:
        """Write-through convenience for the pure `add_queue_item` helper."""
        s = self.load() or self._empty_session()
        s2 = add_queue_item(s, item)
        self.save(s2)
        return s2

    def drop_queue(self, item_id: str) -> AutopilotSession:
        """Write-through convenience for the pure `drop_queue_item` helper."""
        s = self.load() or self._empty_session()
        s2 = drop_queue_item(s, item_id)
        self.save(s2)
        return s2

    def heartbeat(self) -> AutopilotSession:
        """Spec L213: last_heartbeat_at — over 30s without update = disconnected."""
        s = self.load() or self._empty_session()
        s2 = AutopilotSession(
            project_id=s.project_id, state=s.state, config=s.config,
            started_at=s.started_at,
            last_heartbeat_at=datetime.now(timezone.utc).isoformat(),
            current_task=s.current_task, queue=list(s.queue),
            history=list(s.history), circuit=s.circuit,
        )
        self.save(s2)
        return s2

    def update_circuit_snapshot(self, snap: CircuitSnapshot) -> AutopilotSession:
        """Task 1.7: called by runner when CircuitBreaker records a force_pass."""
        s = self.load() or self._empty_session()
        s2 = AutopilotSession(
            project_id=s.project_id, state=s.state, config=s.config,
            started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
            current_task=s.current_task, queue=list(s.queue),
            history=list(s.history), circuit=snap,
        )
        self.save(s2)
        return s2

    def record_force_pass_internal(self) -> AutopilotSession:
        """Spec §2 row 5: write-through wrapper around the runner's force_pass
        logic. Increments circuit.force_pass_count + threshold_warning; if the
        new count crosses CIRCUIT_THRESHOLD (3) and state==running, transitions
        to paused via `circuit_open`. Used by AsyncAutopilotRunner on the
        scene_status=='force_passed' branch."""
        from datetime import datetime, timezone
        from backend.conductor.autopilot_runner import CIRCUIT_THRESHOLD
        s = self.load() or self._empty_session()
        new_count = s.circuit.force_pass_count + 1
        snap = CircuitSnapshot(
            force_pass_count=new_count,
            last_event_at=datetime.now(timezone.utc).isoformat(),
            threshold_warning=new_count >= CIRCUIT_THRESHOLD,
        )
        s2 = self.update_circuit_snapshot(snap)
        crossed = (
            s.circuit.force_pass_count < CIRCUIT_THRESHOLD
            and new_count >= CIRCUIT_THRESHOLD
        )
        if crossed and s2.state == SessionState.RUNNING:
            s3 = self._sm.circuit_open(s2)
            self.save(s3)
            return s3
        return s2


# --- Serialization helpers (used by API layer in Task 1.4) ---

def _session_to_dict(s: AutopilotSession) -> dict:
    return {
        "project_id": s.project_id,
        "state": s.state.value,
        "config": s.config.model_dump() if hasattr(s.config, "model_dump") else asdict(s.config),
        "started_at": s.started_at,
        "last_heartbeat_at": s.last_heartbeat_at,
        "current_task": asdict(s.current_task) if s.current_task else None,
        "queue": [asdict(q) for q in s.queue],
        "history": [asdict(e) for e in s.history],
        "circuit": asdict(s.circuit),
    }


def _dict_to_session(d: dict) -> AutopilotSession:
    return AutopilotSession(
        project_id=d["project_id"],
        state=SessionState(d["state"]),
        config=ManagedStartConfig(**d["config"]),
        started_at=d.get("started_at"),
        last_heartbeat_at=d.get("last_heartbeat_at"),
        current_task=CurrentTask(**d["current_task"]) if d.get("current_task") else None,
        queue=[QueueItem(**q) for q in d.get("queue", [])],
        history=[SessionEvent(**e) for e in d.get("history", [])],
        circuit=CircuitSnapshot(**d.get("circuit", {})),
    )
