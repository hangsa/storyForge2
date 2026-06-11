import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.config import settings


class CheckpointManager:
    CHECKPOINT_FILENAME = ".storyforge_checkpoint.json"

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id

    @property
    def _checkpoint_path(self) -> Path:
        return self._project_dir / self.CHECKPOINT_FILENAME

    def save(
        self,
        pipeline_stage: str,
        current_chapter: int,
        current_scene: int,
        l0_snapshot: Optional[dict] = None,
        registry_snapshots: Optional[dict[str, list[dict]]] = None,
        character_states: Optional[list[dict]] = None,
    ) -> dict:
        checkpoint = {
            "project_id": self.project_id,
            "pipeline_stage": pipeline_stage,
            "current_chapter": current_chapter,
            "current_scene": current_scene,
            "l0_snapshot": l0_snapshot or {},
            "registry_snapshots": registry_snapshots or {},
            "character_states": character_states or [],
            "timestamp": datetime.utcnow().isoformat(),
        }

        self._project_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._checkpoint_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(checkpoint, f, ensure_ascii=False, indent=2)
        tmp.replace(self._checkpoint_path)

        return checkpoint

    def load(self) -> Optional[dict]:
        if not self._checkpoint_path.exists():
            return None
        with open(self._checkpoint_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def has_checkpoint(self) -> bool:
        return self._checkpoint_path.exists()

    def delete(self) -> None:
        if self._checkpoint_path.exists():
            self._checkpoint_path.unlink()

    def recover(self) -> dict:
        checkpoint = self.load()
        if not checkpoint:
            return {
                "recoverable": False,
                "message": "未找到检查点文件",
            }

        missing_files = []
        registry_dir = self._project_dir / "storyos"
        for name, items in checkpoint.get("registry_snapshots", {}).items():
            path = registry_dir / f"{name}.json"
            if not path.exists():
                missing_files.append(str(path))

        if missing_files:
            return {
                "recoverable": True,
                "checkpoint": checkpoint,
                "recovery_instructions": [
                    f"注册表文件缺失: {', '.join(missing_files)}",
                    "将从检查点快照恢复注册表文件",
                ],
                "missing_files": missing_files,
            }

        return {
            "recoverable": True,
            "checkpoint": checkpoint,
            "recovery_instructions": [
                f"恢复至: 第{checkpoint.get('current_chapter', 0)}章 "
                f"第{checkpoint.get('current_scene', 0)}幕 "
                f"({checkpoint.get('pipeline_stage', 'unknown')})"
            ],
            "missing_files": [],
        }

    def restore_registries_from_snapshot(self, snapshot: dict) -> None:
        registry_dir = self._project_dir / "storyos"
        registry_dir.mkdir(parents=True, exist_ok=True)

        for name, items in snapshot.items():
            path = registry_dir / f"{name}.json"
            tmp = path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
            tmp.replace(path)
