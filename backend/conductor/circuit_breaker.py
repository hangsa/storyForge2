from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class CircuitBreakerEvent:
    scene_number: int
    attempt: int
    result: str  # "passed" | "retry" | "force_pass"
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    hints: str = ""


class CircuitBreaker:
    """Max 3 retries, then force-pass with compatibility note."""

    MAX_RETRIES = 3

    def __init__(self):
        self._events: list[CircuitBreakerEvent] = []
        self._scene_retry_count: dict[int, int] = {}

    def reset(self) -> None:
        self._events.clear()
        self._scene_retry_count.clear()

    def check(
        self,
        scene_number: int,
        fact_guard_passed: bool,
        attempt: int,
        hints: str = "",
    ) -> str:
        if fact_guard_passed:
            event = CircuitBreakerEvent(
                scene_number=scene_number,
                attempt=attempt,
                result="passed",
                hints=hints,
            )
            self._events.append(event)
            self._scene_retry_count[scene_number] = 0
            return "passed"

        retry_count = self._scene_retry_count.get(scene_number, 0) + 1
        self._scene_retry_count[scene_number] = retry_count

        if retry_count <= self.MAX_RETRIES:
            event = CircuitBreakerEvent(
                scene_number=scene_number,
                attempt=attempt,
                result="retry",
                hints=hints,
            )
            self._events.append(event)
            return "retry"

        event = CircuitBreakerEvent(
            scene_number=scene_number,
            attempt=attempt,
            result="force_pass",
            hints=hints,
        )
        self._events.append(event)
        return "force_pass"

    def generate_retry_hints(
        self, scene_number: int, fact_guard_details: list[dict]
    ) -> str:
        failed = [c for c in fact_guard_details if not c.get("passed", True)]
        if not failed:
            return ""

        hints = []
        for c in failed:
            hints.append(f"[{c.get('name', '未知检查')}] {c.get('detail', '')}")

        retry_count = self._scene_retry_count.get(scene_number, 0)
        header = f"第{retry_count}次重写提示：\n"
        return header + "\n".join(f"  - {h}" for h in hints)

    def get_retry_count(self, scene_number: int) -> int:
        return self._scene_retry_count.get(scene_number, 0)

    def get_events(self) -> list[CircuitBreakerEvent]:
        return list(self._events)
