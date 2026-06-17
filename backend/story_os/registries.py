import json
import logging
from pathlib import Path
from typing import Optional, Union

from backend.config import settings
from backend.story_os.registry_transaction import (
    RegistryTransactionManager,
    CascadeTrigger,
    CascadeResult,
)

logger = logging.getLogger(__name__)


class RegistryManager:
    """CRUD for 8 narrative asset registries: Conflict, Mystery, Twist, Goal, Promise, Reveal, Expectation, Foreshadowing."""

    REGISTRY_FILES = {
        "conflict": "conflicts.json",
        "mystery": "mysteries.json",
        "twist": "twists.json",
        "goal": "goals.json",
        "promise": "promises.json",
        "reveal": "reveals.json",
        "expectation": "expectations.json",
        "foreshadowing": "foreshadowing.json",
    }

    def __init__(
        self,
        project_id: str,
        projects_dir: Optional[Path] = None,
        transaction_mgr: Optional[RegistryTransactionManager] = None,
    ):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._registries_dir = self.projects_dir / project_id / "storyos"
        self._transaction_mgr = transaction_mgr or RegistryTransactionManager(self.projects_dir)

    def _ensure_dir(self) -> None:
        self._registries_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, registry_type: str) -> Path:
        filename = self.REGISTRY_FILES.get(registry_type, f"{registry_type}s.json")
        return self._registries_dir / filename

    def _read(self, registry_type: str) -> list[dict]:
        path = self._path(registry_type)
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write(self, registry_type: str, data: list[dict]) -> None:
        self._ensure_dir()
        path = self._path(registry_type)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def get_all(self, registry_type: str) -> list[dict]:
        return self._read(registry_type)

    def get_by_id(self, registry_type: str, entry_id: str) -> Optional[dict]:
        items = self._read(registry_type)
        for item in items:
            if item.get("id") == entry_id:
                return item
        return None

    def create(self, registry_type: str, entry: dict) -> bool:
        items = self._read(registry_type)
        entry_id = entry.get("id", "")
        if entry_id and any(item.get("id") == entry_id for item in items):
            return False
        items.append(entry)
        self._write(registry_type, items)
        return True

    def update(self, registry_type: str, entry_id: str, updates: dict) -> bool:
        items = self._read(registry_type)
        for item in items:
            if item.get("id") == entry_id:
                item.update(updates)
                self._write(registry_type, items)
                return True
        return False

    def delete(self, registry_type: str, entry_id: str) -> bool:
        items = self._read(registry_type)
        new_items = [item for item in items if item.get("id") != entry_id]
        if len(new_items) == len(items):
            return False
        self._write(registry_type, new_items)
        return True

    def exists(self, registry_type: str, entry_id: str) -> bool:
        return self.get_by_id(registry_type, entry_id) is not None

    def add_clue(self, mystery_id: str, clue: dict) -> bool:
        mystery = self.get_by_id("mystery", mystery_id)
        if not mystery:
            return False
        clues = mystery.get("clues", [])
        clues.append(clue)
        return self.update("mystery", mystery_id, {"clues": clues})

    def escalate_conflict(
        self, conflict_id: str, new_intensity: str, trigger: str = ""
    ) -> bool:
        conflict = self.get_by_id("conflict", conflict_id)
        if not conflict:
            return False
        old_intensity = conflict.get("intensity", "")
        event = {
            "from_intensity": old_intensity,
            "to_intensity": new_intensity,
            "trigger": trigger,
        }
        history = conflict.get("escalation_history", [])
        history.append(event)
        return self.update("conflict", conflict_id, {
            "intensity": new_intensity,
            "escalation_history": history,
        })

    # --- v1.6: Cascade-aware status update ---

    def update_asset_status(
        self, asset_type: str, asset_id: str, new_status: str
    ) -> CascadeResult:
        """
        更新资产状态 → 检测级联触发 → 执行级联传播 → 写入注册表。

        这是 v1.6 替代直接 update() 调用的推荐方式。
        如果状态变更触发了级联规则，自动展开和验证级联路径。
        """
        entry = self.get_by_id(asset_type, asset_id)
        if not entry:
            return CascadeResult(
                success=False,
                conflict_details=[f"资产不存在：{asset_type}/{asset_id}"],
            )

        old_status = entry.get("status", "")

        # Detect cascade trigger before writing anything
        trigger = self._detect_cascade_trigger(asset_type, old_status, new_status, asset_id)

        if trigger is None:
            # No cascade needed — simple status update
            self.update(asset_type, asset_id, {"status": new_status})
            # Check for orphaned mysteries on conflict resolution
            orphaned: list[str] = []
            if asset_type == "conflict" and new_status == "resolved":
                orphaned = self._transaction_mgr.check_orphaned_mysteries(
                    self.project_id, asset_id
                )
                if orphaned:
                    logger.warning(
                        "Conflict %s resolved, orphaned mysteries: %s", asset_id, orphaned
                    )
            return CascadeResult(success=True, orphaned_mysteries=orphaned)

        # Execute cascade propagation first (atomic with its own rollback)
        result = self._transaction_mgr.propagate(
            self.project_id, trigger, asset_type, asset_id
        )

        # Write primary update after cascade completes
        self.update(asset_type, asset_id, {"status": new_status})

        if not result.success:
            logger.warning(
                "Cascade partially blocked for %s/%s → %s: %d executed, %d blocked",
                asset_type, asset_id, new_status,
                len(result.steps_executed), len(result.blocked_steps),
            )
            # Executed steps were already written by RegistryTransactionManager
            # Blocked steps are reported for manual review

        return result

    def _detect_cascade_trigger(
        self, asset_type: str, old_status: str, new_status: str, asset_id: str = ""
    ) -> Optional[CascadeTrigger]:
        """
        根据状态变更判断是否触发级联。

        特殊处理：Conflict → resolved 不触发标准级联链，
        而是触发孤儿 Mystery 检查（警告，不阻断）。
        """
        # Conflict → resolved: no cascade, orphan check handled by caller
        if asset_type == "conflict" and new_status == "resolved":
            return None

        # Mystery → revealed
        if asset_type == "mystery" and new_status == "revealed" and old_status != "revealed":
            return CascadeTrigger.MYSTERY_REVEALED

        # Twist → revealed
        if asset_type == "twist" and new_status == "revealed" and old_status != "revealed":
            return CascadeTrigger.TWIST_REVEALED

        # Reveal → revealed
        if asset_type == "reveal" and new_status == "revealed" and old_status != "revealed":
            return CascadeTrigger.REVEAL_REVEALED

        # Promise → fulfilled
        if asset_type == "promise" and new_status == "fulfilled" and old_status != "fulfilled":
            return CascadeTrigger.PROMISE_FULFILLED

        return None

    # --- Promise ---

    def fulfill_promise(self, promise_id: str, chapter: int, scene: int = 0) -> bool:
        return self.update("promise", promise_id, {
            "status": "fulfilled",
            "fulfilled_chapter": chapter,
            "fulfilled_scene": scene,
        })

    def list_pending_promises(self) -> list[dict]:
        return [p for p in self._read("promise") if p.get("status") == "pending"]

    # --- Reveal ---

    def reveal(self, reveal_id: str, chapter: int, method: str = "") -> bool:
        return self.update("reveal", reveal_id, {
            "status": "revealed",
            "revealed_chapter": chapter,
            "reveal_method": method,
        })

    def list_hidden_from(self, character_id: str) -> list[dict]:
        return [
            r for r in self._read("reveal")
            if r.get("status") == "hidden" and r.get("about") == character_id
        ]

    # --- Expectation ---

    def fulfill_expectation(self, expectation_id: str, chapter: int) -> bool:
        return self.update("expectation", expectation_id, {
            "status": "fulfilled",
            "fulfilled_chapter": chapter,
        })

    def update_expectation_intensity(self, expectation_id: str, delta: int) -> bool:
        entry = self.get_by_id("expectation", expectation_id)
        if not entry:
            return False
        new_intensity = max(0, min(100, entry.get("intensity", 50) + delta))
        return self.update("expectation", expectation_id, {"intensity": new_intensity})

    def list_accumulating(self) -> list[dict]:
        result = self._read("expectation")
        result.sort(key=lambda e: e.get("intensity", 0), reverse=True)
        return [e for e in result if e.get("status") == "accumulating"]

    # --- Foreshadowing ---

    def add_foreshadowing_clue(self, fs_id: str, clue: dict) -> bool:
        entry = self.get_by_id("foreshadowing", fs_id)
        if not entry:
            return False
        clues = entry.get("clues", [])
        clues.append(clue)
        new_status = "developing" if entry.get("status") == "planted" else entry.get("status")
        return self.update("foreshadowing", fs_id, {
            "clues": clues,
            "status": new_status,
        })

    def reveal_foreshadowing(self, fs_id: str, chapter: int, detail: str) -> bool:
        return self.update("foreshadowing", fs_id, {
            "status": "revealed",
            "revealed_chapter": chapter,
            "reveal_detail": detail,
        })

    def mark_foreshadowing_dead(self, fs_id: str) -> bool:
        return self.update("foreshadowing", fs_id, {"status": "dead"})

    def list_dead_foreshadowings(self) -> list[dict]:
        return [f for f in self._read("foreshadowing") if f.get("status") == "dead"]

    def list_planted_without_clues(self, current_chapter: int, min_chapters: int = 5) -> list[dict]:
        return [
            f for f in self._read("foreshadowing")
            if f.get("status") == "planted"
            and f.get("created_chapter", 0) <= current_chapter - min_chapters
        ]
