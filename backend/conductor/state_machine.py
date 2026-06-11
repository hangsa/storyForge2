from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


class Stage(str, Enum):
    INIT = "INIT"
    STAGE1 = "STAGE1"
    STAGE2 = "STAGE2"
    STAGE3 = "STAGE3"
    STAGE4 = "STAGE4"
    COMPLETED = "COMPLETED"


STAGE_ORDER = [
    Stage.INIT,
    Stage.STAGE1,
    Stage.STAGE2,
    Stage.STAGE3,
    Stage.STAGE4,
    Stage.COMPLETED,
]

# Each check tuple: (file, json_path, check_fn, error_msg)
PRECONDITIONS: dict[Stage, list[tuple]] = {
    Stage.STAGE1: [
        ("project.json", "title", lambda v: bool(v), "title 不能为空"),
        ("project.json", "genre", lambda v: bool(v), "genre 不能为空"),
    ],
    Stage.STAGE2: [
        (
            "concept_and_dna.json",
            "story_dna.core_contradiction.statement",
            lambda v: bool(v),
            "core_contradiction.statement 不能为空",
        ),
    ],
    Stage.STAGE3: [
        (
            "characters.json",
            "characters",
            lambda v: isinstance(v, list) and len(v) >= 1,
            "characters 数组长度必须 >= 1",
        ),
        (
            "world.json",
            "",
            lambda v: v is not None,
            "world.json 不能为空",
        ),
    ],
    Stage.STAGE4: [
        ("outline.json", "chapters", lambda v: isinstance(v, list) and len(v) >= 1, "chapters 数组不能为空"),
        ("outline.json", "chapters[0].scene_plan", lambda v: bool(v), "chapters[0].scene_plan 不能为空"),
    ],
    Stage.COMPLETED: [
        (
            "progress.json",
            "chapters",
            lambda v: isinstance(v, list)
            and all(
                s.get("status") in ("completed", "force_passed")
                for ch in v
                for s in ch.get("scenes", [])
            ),
            "所有 Scene 状态必须为 completed 或 force_passed",
        ),
    ],
}


@dataclass
class TransitionResult:
    allowed: bool
    from_stage: Stage
    to_stage: Stage
    missing_files: list[str] = field(default_factory=list)
    failed_checks: list[str] = field(default_factory=list)
    message: str = ""


class StageStateMachine:
    def __init__(self, projects_dir: Path):
        self.projects_dir = Path(projects_dir)

    def _project_dir(self, project_id: str) -> Path:
        return self.projects_dir / project_id

    def _read_json(self, project_id: str, filename: str) -> Optional[dict]:
        path = self._project_dir(project_id) / filename
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            import json
            return json.load(f)

    def get_current_stage(self, project_id: str) -> Stage:
        data = self._read_json(project_id, "project.json")
        if not data:
            return Stage.INIT
        return Stage(data.get("current_stage", "INIT"))

    def get_next_stage(self, current: Stage) -> Optional[Stage]:
        try:
            idx = STAGE_ORDER.index(current)
            if idx < len(STAGE_ORDER) - 1:
                return STAGE_ORDER[idx + 1]
        except ValueError:
            pass
        return None

    def get_precondition(self, target_stage: Stage) -> list[tuple]:
        return PRECONDITIONS.get(target_stage, [])

    def _resolve_nested(self, data: dict, path: str) -> Optional[object]:
        keys = path.replace("[", ".").replace("]", "").split(".")
        current = data
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key)
            elif isinstance(current, list):
                try:
                    current = current[int(key)]
                except (IndexError, ValueError):
                    return None
            else:
                return None
            if current is None:
                return None
        return current

    def transition_check(self, project_id: str, target_stage: Stage) -> TransitionResult:
        current = self.get_current_stage(project_id)
        expected_next = self.get_next_stage(current)

        if expected_next is None:
            return TransitionResult(
                allowed=False,
                from_stage=current,
                to_stage=target_stage,
                message=f"无法从 {current.value} 推进：已到达最终阶段",
            )

        if target_stage != expected_next:
            return TransitionResult(
                allowed=False,
                from_stage=current,
                to_stage=target_stage,
                message=f"无效的阶段转换：{current.value} → {target_stage.value}，"
                f"期望 → {expected_next.value}",
            )

        checks = self.get_precondition(target_stage)
        missing_files: list[str] = []
        failed_checks: list[str] = []
        seen_missing: set[str] = set()

        for filename, json_path, check_fn, error_msg in checks:
            if filename in seen_missing:
                continue

            data = self._read_json(project_id, filename)
            if data is None:
                missing_files.append(filename)
                seen_missing.add(filename)
                continue

            if json_path:
                value = self._resolve_nested(data, json_path)
            else:
                value = data

            if not check_fn(value):
                failed_checks.append(f"{filename}: {error_msg}")

        if missing_files or failed_checks:
            parts = []
            if missing_files:
                parts.append(f"缺少文件: {', '.join(missing_files)}")
            if failed_checks:
                parts.append(f"检查未通过: {'; '.join(failed_checks)}")
            return TransitionResult(
                allowed=False,
                from_stage=current,
                to_stage=target_stage,
                missing_files=missing_files,
                failed_checks=failed_checks,
                message=" | ".join(parts),
            )

        return TransitionResult(
            allowed=True,
            from_stage=current,
            to_stage=target_stage,
            message=f"阶段转换 {current.value} → {target_stage.value} 允许",
        )

    def advance(self, project_id: str, target_stage: Stage) -> TransitionResult:
        result = self.transition_check(project_id, target_stage)

        if not result.allowed:
            return result

        project_file = self._project_dir(project_id) / "project.json"
        data = self._read_json(project_id, "project.json")
        if data is None:
            return TransitionResult(
                allowed=False,
                from_stage=result.from_stage,
                to_stage=target_stage,
                message="project.json 不存在",
            )

        data["current_stage"] = target_stage.value
        transition = {
            "from_stage": result.from_stage.value,
            "to_stage": target_stage.value,
            "timestamp": datetime.utcnow().isoformat(),
        }
        if "stage_history" not in data:
            data["stage_history"] = []
        data["stage_history"].append(transition)

        import json

        tmp_file = project_file.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp_file.replace(project_file)

        return result
