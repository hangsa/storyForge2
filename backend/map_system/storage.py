"""map.json 的 load/save — 沿用 FileManager 的 atomic write 模式。"""
import json
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.map_system.models import Map


def _project_dir(project_id: str) -> Path:
    return settings.projects_dir / project_id


def _ensure_dirs(project_dir: Path) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "map_snapshots").mkdir(exist_ok=True)


def load_map(project_id: str) -> Optional[dict]:
    path = _project_dir(project_id) / "map.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_map(project_id: str, map_data: Map) -> None:
    project_dir = _project_dir(project_id)
    _ensure_dirs(project_dir)
    target = project_dir / "map.json"
    tmp = target.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(map_data.model_dump(by_alias=True), f, ensure_ascii=False, indent=2)
    tmp.replace(target)
