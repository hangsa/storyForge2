"""
CircuitBreaker unit tests — retry counting, force-pass threshold, hints generation.
Covers AC-4: 3 retries then circuit breaker triggers.
"""

import pytest

from backend.conductor.circuit_breaker import CircuitBreaker, CircuitBreakerEvent


@pytest.fixture
def cb():
    return CircuitBreaker()


class TestPassedScenario:
    def test_passed_resets_retry_count(self, cb):
        result = cb.check(scene_number=1, fact_guard_passed=True, attempt=1)
        assert result == "passed"
        assert cb.get_retry_count(1) == 0

    def test_passed_creates_event(self, cb):
        cb.check(scene_number=1, fact_guard_passed=True, attempt=1)
        events = cb.get_events()
        assert len(events) == 1
        assert events[0].result == "passed"


class TestRetryScenario:
    def test_first_failure_returns_retry(self, cb):
        result = cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        assert result == "retry"
        assert cb.get_retry_count(1) == 1

    def test_second_failure_returns_retry(self, cb):
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        result = cb.check(scene_number=1, fact_guard_passed=False, attempt=2)
        assert result == "retry"
        assert cb.get_retry_count(1) == 2

    def test_third_failure_returns_retry(self, cb):
        """AC-4: Up to 3 retries allowed (checks 0→1, 1→2, 2→3)."""
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        cb.check(scene_number=1, fact_guard_passed=False, attempt=2)
        result = cb.check(scene_number=1, fact_guard_passed=False, attempt=3)
        assert result == "retry"
        assert cb.get_retry_count(1) == 3


class TestForcePass:
    def test_fourth_failure_triggers_force_pass(self, cb):
        """AC-4: After 3 retries, the 4th attempt triggers force_pass."""
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        cb.check(scene_number=1, fact_guard_passed=False, attempt=2)
        cb.check(scene_number=1, fact_guard_passed=False, attempt=3)
        result = cb.check(scene_number=1, fact_guard_passed=False, attempt=4)
        assert result == "force_pass"

    def test_force_pass_persists_retry_count(self, cb):
        for i in range(4):
            cb.check(scene_number=1, fact_guard_passed=False, attempt=i + 1)
        assert cb.get_retry_count(1) == 4


class TestRetryHints:
    def test_generates_hints_for_failed_checks(self, cb):
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        details = [
            {"name": "时间线连续性", "passed": False, "detail": "位置序列异常"},
            {"name": "角色状态一致性", "passed": True, "detail": "OK"},
            {"name": "世界规则一致性", "passed": False, "detail": "触及上限"},
        ]
        hints = cb.generate_retry_hints(1, details)
        assert "第1次重写提示" in hints
        assert "时间线连续性" in hints
        assert "世界规则一致性" in hints
        assert "角色状态一致性" not in hints

    def test_empty_hints_when_all_pass(self, cb):
        details = [{"name": "检查1", "passed": True}, {"name": "检查2", "passed": True}]
        assert cb.generate_retry_hints(1, details) == ""


class TestMultipleScenes:
    def test_independent_scene_counters(self, cb):
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        cb.check(scene_number=1, fact_guard_passed=False, attempt=2)
        assert cb.get_retry_count(1) == 2
        assert cb.get_retry_count(2) == 0

        cb.check(scene_number=2, fact_guard_passed=False, attempt=1)
        assert cb.get_retry_count(1) == 2
        assert cb.get_retry_count(2) == 1


class TestReset:
    def test_reset_clears_all_state(self, cb):
        cb.check(scene_number=1, fact_guard_passed=False, attempt=1)
        cb.reset()
        assert cb.get_retry_count(1) == 0
        assert len(cb.get_events()) == 0
