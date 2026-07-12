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
    complete_current_task, set_current_task,
)

logger = logging.getLogger(__name__)


SESSION_FILENAME = "session.json"
SESSION_DIRNAME = "autopilot"


class AutopilotSessionManager:
    """Owns the on-disk file for one project's AutopilotSession."""

    def __init__(self, projects_dir: Path, project_id: str) -> None:
        self._projects_dir = Path(projects_dir)
        self._project_id = project_id
        self._session_dir = self._projects_dir / project_id / SESSION_DIRNAME
        self._session_file = self._session_dir / SESSION_FILENAME
        self._sm = SessionStateMachine()

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
            return _dict_to_session(raw)
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
