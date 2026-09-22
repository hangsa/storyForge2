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


def build_name_index(project_id: str) -> dict[str, str]:
    """构建 name/alias → canonical id 的反向索引。

    用于把 SF_LOG character_location_change / mention extraction 的裸
    location 字符串归一化到 location_id / region_id / poi_id。

    Returns empty dict if map.json missing — callers should treat as no-op.
    """
    data = load_map(project_id)
    if not data:
        return {}
    index: dict[str, str] = {}
    for region in data.get("regions", []):
        index[region["name"]] = region["id"]
        for alias in region.get("aliases", []):
            index[alias] = region["id"]
    for loc in data.get("locations", []):
        index[loc["name"]] = loc["id"]
        for alias in loc.get("aliases", []):
            index[alias] = loc["id"]
    for poi in data.get("pois", []):
        index[poi["name"]] = poi["id"]
    return index
