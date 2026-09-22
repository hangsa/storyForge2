"""章节快照落盘 + 回滚。"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .models import Map
from .storage import load_map, save_map, _project_dir

SNAPSHOTS_SUBDIR = "map_snapshots"


def _snapshots_dir(project_id: str) -> Path:
    return _project_dir(project_id) / SNAPSHOTS_SUBDIR


def snapshot_path(project_id: str, chapter: int) -> Path:
    return _snapshots_dir(project_id) / f"chapter_{chapter:03d}.json"


def compute_map_hash(map_obj: Map) -> str:
    """对 Map 内容算 SHA-256 十六进制串(顺序敏感)。"""
    payload = map_obj.model_dump_json(exclude_none=True, exclude={"created_at", "updated_at"})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def snapshot_map_at_chapter(project_id: str, chapter: int) -> Path:
    """把当前 map.json 落盘到 map_snapshots/chapter_NNN.json。"""
    raw = load_map(project_id)
    if raw is None:
        raise FileNotFoundError(f"No map.json for project {project_id}")
    m = Map.model_validate(raw)
    body = {
        "schema_version": "1.0",
        "project_id": project_id,
        "chapter": chapter,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_hash": compute_map_hash(m)[:12],
        "map": json.loads(m.model_dump_json(exclude_none=True)),
    }
    target = snapshot_path(project_id, chapter)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(body, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return target


def rollback_map_to_chapter(project_id: str, chapter: int) -> Map:
    """把 map.json 替换为快照内容,返回新 Map。"""
    src = snapshot_path(project_id, chapter)
    if not src.exists():
        raise FileNotFoundError(f"No snapshot for {project_id}/chapter_{chapter}")
    body = json.loads(src.read_text(encoding="utf-8"))
    restored = Map.model_validate(body["map"])
    save_map(project_id, restored)
    return restored


def list_snapshots(project_id: str) -> list[dict]:
    """列出 [{chapter, created_at, snapshot_hash, locations_count, routes_count}],按 chapter 升序。"""
    d = _snapshots_dir(project_id)
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("chapter_*.json")):
        body = json.loads(p.read_text(encoding="utf-8"))
        m = body.get("map", {})
        out.append({
            "chapter": body["chapter"],
            "created_at": body["created_at"],
            "snapshot_hash": body["snapshot_hash"],
            "locations_count": len(m.get("locations", [])),
            "routes_count": len(m.get("routes", [])),
        })
    return out
