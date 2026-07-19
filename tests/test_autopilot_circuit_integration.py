"""Tests for circuit breaker <-> AutopilotSession integration.

Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L217, L258, L287.
L217: `circuit: CircuitSnapshot` is part of AutopilotSession.
L258: `running --[circuit_open]--> paused` (auto-pause).
L287: circuit field reflects v1.6 熔断器累计强制通过次数; 超阈值下次重复触发
      时给写警示（不阻断）.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor.autopilot_runner import AutopilotRunner, RecordingExecutor
from backend.conductor.circuit_breaker import CircuitBreaker
from backend.models.autopilot_session import (
    ManagedStartConfig, SessionState, SessionStateMachine,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(json.dumps({
        "id": "p1", "title": "T", "current_stage": "STAGE4",
    }), encoding="utf-8")
    return tmp_path


@pytest.fixture
def mgr(projects_dir: Path) -> AutopilotSessionManager:
    return AutopilotSessionManager(projects_dir, "p1")


# ---------------------------------------------------------------------------
# Session.circuit default shape (spec L217)
# ---------------------------------------------------------------------------

class TestSessionCircuitField:
    def test_session_circuit_starts_at_zero(self, mgr):
        mgr.start(ManagedStartConfig())
        s = mgr.load()
        assert s.circuit.force_pass_count == 0
        assert s.circuit.threshold_warning is False
        assert s.circuit.last_event_at is None

    def test_record_force_pass_increments_once(self, mgr):
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        runner.record_force_pass()
        s = mgr.load()
        assert s.circuit.force_pass_count == 1
        assert s.circuit.threshold_warning is False
        assert s.circuit.last_event_at is not None

    def test_threshold_warning_at_three(self, mgr):
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        for _ in range(3):
            runner.record_force_pass()
        s = mgr.load()
        assert s.circuit.force_pass_count == 3
        assert s.circuit.threshold_warning is True  # spec L287

    def test_threshold_warning_at_four_still_warns(self, mgr):
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        for _ in range(4):
            runner.record_force_pass()
        s = mgr.load()
        assert s.circuit.force_pass_count == 4
        assert s.circuit.threshold_warning is True


# ---------------------------------------------------------------------------
# circuit_open auto-pause (spec L258)
# ---------------------------------------------------------------------------

class TestCircuitOpenAutoPause:
    def test_circuit_open_from_running_pauses(self, mgr):
        mgr.start(ManagedStartConfig())
        sm = SessionStateMachine()
        s = sm.circuit_open(mgr.load())
        mgr.save(s)
        assert mgr.load().state == SessionState.PAUSED

    def test_circuit_open_appears_in_history(self, mgr):
        mgr.start(ManagedStartConfig())
        sm = SessionStateMachine()
        s = sm.circuit_open(mgr.load())
        mgr.save(s)
        assert any(e.type == "circuit_open" for e in mgr.load().history)

    def test_record_force_pass_at_threshold_auto_pauses(self, mgr):
        """3rd force_pass crosses the threshold and should trigger circuit_open → paused.

        Spec L258 + L287: at the threshold-crossing moment the session is
        auto-paused. 'Not blocked' (不阻断) means we don't refuse writes;
        auto-pause is a separate concern.
        """
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        runner.record_force_pass()  # 1
        runner.record_force_pass()  # 2
        assert mgr.load().state == SessionState.RUNNING  # not yet
        runner.record_force_pass()  # 3 → threshold crossed
        s = mgr.load()
        assert s.circuit.force_pass_count == 3
        assert s.state == SessionState.PAUSED
        assert any(e.type == "circuit_open" for e in s.history)

    def test_paused_state_keeps_paused_on_extra_force_pass(self, mgr):
        """Once auto-paused, further force_pass events don't re-fire circuit_open
        (it's a transition, not an event stream of every retry). The threshold
        stays at warning=True.
        """
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        for _ in range(5):
            runner.record_force_pass()
        s = mgr.load()
        assert s.state == SessionState.PAUSED
        circuit_open_events = [e for e in s.history if e.type == "circuit_open"]
        assert len(circuit_open_events) == 1  # not 5

    def test_force_pass_after_resume_does_not_reopen_circuit(self, mgr):
        """If user resumes after auto-pause, additional force_pass events are
        tracked but do not re-fire circuit_open — that would be a new failure
        window. (Stage 2 will decide whether to fire again; for Stage 1 we
        keep it monotonic: auto-pause fires exactly once per threshold-crossing.)
        """
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        runner.record_force_pass()  # 1
        runner.record_force_pass()  # 2
        runner.record_force_pass()  # 3 → auto-pause
        mgr.resume()
        assert mgr.load().state == SessionState.RUNNING
        runner.record_force_pass()  # 4 → count goes up, no circuit_open event
        s = mgr.load()
        assert s.circuit.force_pass_count == 4
        circuit_open_events = [e for e in s.history if e.type == "circuit_open"]
        assert len(circuit_open_events) == 1


# ---------------------------------------------------------------------------
# CircuitBreaker -> session sync via injected breaker (the real integration)
# ---------------------------------------------------------------------------

class TestCircuitBreakerToSessionSync:
    """Real CircuitBreaker force_pass count flows into session via sync_circuit_breaker."""

    def test_force_pass_count_flows_to_session(self, mgr):
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        # Force 4 failures: 3 retries + 1 force_pass (per cb.MAX_RETRIES=3).
        for i in range(4):
            cb.check(scene_number=1, fact_guard_passed=False, attempt=i + 1)
        force_pass_events = [e for e in cb.get_events() if e.result == "force_pass"]
        runner = AutopilotRunner(mgr, RecordingExecutor())
        for _ in force_pass_events:
            runner.record_force_pass()
        assert mgr.load().circuit.force_pass_count == len(force_pass_events)

    def test_sync_circuit_breaker_pulls_force_pass_events(self, mgr):
        """Integration: runner's sync method reads from a real CircuitBreaker."""
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        runner = AutopilotRunner(mgr, RecordingExecutor(), circuit_breaker=cb)
        # 4 failures = 3 retries + 1 force_pass
        for i in range(4):
            cb.check(scene_number=1, fact_guard_passed=False, attempt=i + 1)
        result = runner.sync_circuit_breaker()
        assert result["new_force_passes"] == 1
        assert mgr.load().circuit.force_pass_count == 1

    def test_sync_circuit_breaker_is_idempotent(self, mgr):
        """Re-syncing does NOT double-count events (uses cursor)."""
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        for i in range(4):
            cb.check(scene_number=1, fact_guard_passed=False, attempt=i + 1)
        runner = AutopilotRunner(mgr, RecordingExecutor(), circuit_breaker=cb)
        first = runner.sync_circuit_breaker()
        second = runner.sync_circuit_breaker()
        assert first["new_force_passes"] == 1
        assert second["new_force_passes"] == 0
        assert mgr.load().circuit.force_pass_count == 1

    def test_sync_circuit_breaker_crosses_threshold_auto_pauses(self, mgr):
        """When the cumulative session count crosses 3, the runner auto-pauses
        the session via circuit_open. This is the headline integration test.
        """
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        runner = AutopilotRunner(mgr, RecordingExecutor(), circuit_breaker=cb)

        # Scene 1: 4 failures → 1 force_pass
        for i in range(4):
            cb.check(scene_number=1, fact_guard_passed=False, attempt=i + 1)
        # Scene 2: 4 failures → 1 force_pass (now total = 2)
        for i in range(4):
            cb.check(scene_number=2, fact_guard_passed=False, attempt=i + 1)
        # Scene 3: 4 failures → 1 force_pass (now total = 3 → threshold crossed)
        for i in range(4):
            cb.check(scene_number=3, fact_guard_passed=False, attempt=i + 1)

        result = runner.sync_circuit_breaker()
        assert result["new_force_passes"] == 3
        assert result["circuit_opened"] is True
        s = mgr.load()
        assert s.state == SessionState.PAUSED
        assert s.circuit.force_pass_count == 3
        assert s.circuit.threshold_warning is True
        assert any(e.type == "circuit_open" for e in s.history)

    def test_sync_circuit_breaker_below_threshold_does_not_pause(self, mgr):
        """2 force-passes (below threshold) keep the session running."""
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        runner = AutopilotRunner(mgr, RecordingExecutor(), circuit_breaker=cb)
        for scene in (1, 2):
            for i in range(4):
                cb.check(scene_number=scene, fact_guard_passed=False, attempt=i + 1)
        result = runner.sync_circuit_breaker()
        assert result["new_force_passes"] == 2
        assert result["circuit_opened"] is False
        assert mgr.load().state == SessionState.RUNNING
        assert mgr.load().circuit.threshold_warning is False

    def test_sync_without_breaker_is_noop(self, mgr):
        """Runner without injected breaker stays sync-safe (no exception)."""
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())  # no circuit_breaker
        result = runner.sync_circuit_breaker()
        assert result == {"new_force_passes": 0, "circuit_opened": False}
        assert mgr.load().circuit.force_pass_count == 0

    def test_passing_scenes_do_not_increment_circuit(self, mgr):
        """Only force_pass events feed the session counter. 'passed' events are
        ignored (they don't increase failure count)."""
        mgr.start(ManagedStartConfig())
        cb = CircuitBreaker()
        cb.check(scene_number=1, fact_guard_passed=True, attempt=1)
        cb.check(scene_number=2, fact_guard_passed=True, attempt=1)
        runner = AutopilotRunner(mgr, RecordingExecutor(), circuit_breaker=cb)
        result = runner.sync_circuit_breaker()
        assert result["new_force_passes"] == 0
        assert mgr.load().circuit.force_pass_count == 0
        assert mgr.load().state == SessionState.RUNNING


# ---------------------------------------------------------------------------
# Persistence round-trip
# ---------------------------------------------------------------------------

class TestCircuitSnapshotPersists:
    def test_circuit_snapshot_survives_reload(self, mgr, projects_dir):
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, RecordingExecutor())
        runner.record_force_pass()
        runner.record_force_pass()
        # New manager = simulate server restart
        fresh = AutopilotSessionManager(projects_dir, "p1").load()
        assert fresh.circuit.force_pass_count == 2
        assert fresh.circuit.last_event_at is not None