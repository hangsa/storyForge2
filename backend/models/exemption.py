"""Creative Exemption — v1.7 (T3.5).

Writer requests exemption from a constraint when creative intent justifies
breaking the rule. User approves/rejects; the manager tracks outcomes
and feeds the antipattern registry.
"""

import json
import logging
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# Valid status transitions
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
VALID_STATUSES = {STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED}

# Outcome evaluation
OUTCOME_EXCELLENT = "excellent"
OUTCOME_GOOD = "good"
OUTCOME_POOR = "poor"
VALID_OUTCOMES = {OUTCOME_EXCELLENT, OUTCOME_GOOD, OUTCOME_POOR}

# Antipattern threshold reserved for future gating logic — see check_antipatterns().
ANTIPATTERN_THRESHOLD = 3  # noqa: F841 — reserved for "surface only after N rejections" rule


@dataclass
class ExemptionRequest:
    id: str
    scene_id: str
    rule_to_break: dict            # {layer, rule_id, rule_description, constraint_type}
    creative_intent: str
    expected_effect: str
    status: str = STATUS_PENDING
    requested_by: str = "writer"
    requested_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    approved_by: Optional[str] = None
    rejected_reason: Optional[str] = None
    outcome: Optional[str] = None  # OUTCOME_* | None
    outcome_evaluated_at: Optional[str] = None


@dataclass
class ExemptionAntipattern:
    rule_id: str
    creative_intent_pattern: str        # regex/keywords
    count: int = 0
    representative_case: str = ""        # summary of one rejected example


class ExemptionManager:
    """Owns the exemption lifecycle for one project."""

    def __init__(self, project_dir: Path) -> None:
        self._dir = Path(project_dir)

    # --- I/O ---

    def _progress_path(self) -> Path:
        return self._dir / "progress.json"

    def _antipatterns_path(self) -> Path:
        return self._dir / "creative_os" / "exemption_antipatterns.json"

    def _read_progress(self) -> dict:
        path = self._progress_path()
        if not path.exists():
            return {"exemptions": []}
        try:
            return json.loads(path.read_text(encoding="utf-8")) or {}
        except Exception as e:
            logger.warning("Failed to read progress.json: %s", e)
            return {"exemptions": []}

    def _write_progress(self, data: dict) -> None:
        path = self._progress_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def _read_antipatterns(self) -> list[dict]:
        path = self._antipatterns_path()
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8")) or []
        except Exception as e:
            logger.warning("Failed to read antipatterns: %s", e)
            return []

    def _write_antipatterns(self, items: list[dict]) -> None:
        path = self._antipatterns_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    # --- public API ---

    def submit(self, request: ExemptionRequest) -> None:
        data = self._read_progress()
        data.setdefault("exemptions", []).append(asdict(request))
        self._write_progress(data)

    def approve(self, exemption_id: str, approved_by: str) -> None:
        self._update_status(exemption_id, STATUS_APPROVED, approved_by=approved_by)

    def reject(self, exemption_id: str, reason: str) -> None:
        self._update_status(exemption_id, STATUS_REJECTED, rejected_reason=reason)
        # Feed the antipattern registry
        self._record_antipattern(exemption_id, reason)

    def evaluate_outcome(self, exemption_id: str, outcome: str) -> None:
        if outcome not in VALID_OUTCOMES:
            raise ValueError(f"Invalid outcome: {outcome}. Must be one of {VALID_OUTCOMES}")
        data = self._read_progress()
        for ex in data.get("exemptions", []):
            if ex.get("id") == exemption_id:
                ex["outcome"] = outcome
                ex["outcome_evaluated_at"] = datetime.now(timezone.utc).isoformat()
                self._write_progress(data)
                return
        raise KeyError(f"Exemption {exemption_id} not found")

    def get(self, exemption_id: str) -> Optional[ExemptionRequest]:
        data = self._read_progress()
        for ex in data.get("exemptions", []):
            if ex.get("id") == exemption_id:
                return ExemptionRequest(**ex)
        return None

    def list_all(self) -> list[ExemptionRequest]:
        data = self._read_progress()
        return [ExemptionRequest(**ex) for ex in data.get("exemptions", []) if isinstance(ex, dict)]

    def check_antipatterns(self, rule_id: str, intent: str) -> list[ExemptionAntipattern]:
        """Pure rule matching — no LLM. Returns antipatterns for similar intents on this rule."""
        items = self._read_antipatterns()
        out = []
        for item in items:
            if item.get("rule_id") != rule_id:
                continue
            pattern = item.get("creative_intent_pattern", "")
            if pattern and re.search(pattern, intent, re.IGNORECASE):
                out.append(ExemptionAntipattern(
                    rule_id=item["rule_id"],
                    creative_intent_pattern=pattern,
                    count=item.get("count", 0),
                    representative_case=item.get("representative_case", ""),
                ))
        return out

    def is_exempted(self, scene_id: str, rule_id: str) -> bool:
        """True if scene has an approved exemption for rule_id."""
        for ex in self.list_all():
            if (
                ex.scene_id == scene_id
                and ex.status == STATUS_APPROVED
                and ex.rule_to_break.get("rule_id") == rule_id
            ):
                return True
        return False

    # --- private ---

    def _update_status(self, exemption_id: str, status: str, **fields) -> None:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        data = self._read_progress()
        for ex in data.get("exemptions", []):
            if ex.get("id") == exemption_id:
                ex["status"] = status
                ex.update(fields)
                self._write_progress(data)
                return
        raise KeyError(f"Exemption {exemption_id} not found")

    def _record_antipattern(self, exemption_id: str, reason: str) -> None:
        ex = self.get(exemption_id)
        if ex is None:
            return
        items = self._read_antipatterns()
        rule_id = ex.rule_to_break.get("rule_id", "")
        # Use first 12 chars of intent as a coarse pattern (deterministic, zero-LLM)
        pattern = re.escape(ex.creative_intent[:12]) if ex.creative_intent else ""

        # Update existing antipattern for this rule_id+pattern
        for item in items:
            if item.get("rule_id") == rule_id and item.get("creative_intent_pattern") == pattern:
                item["count"] = item.get("count", 0) + 1
                item["representative_case"] = reason[:120]
                self._write_antipatterns(items)
                return

        # Otherwise create a new entry
        items.append({
            "rule_id": rule_id,
            "creative_intent_pattern": pattern,
            "count": 1,
            "representative_case": reason[:120],
        })
        self._write_antipatterns(items)