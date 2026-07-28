#!/usr/bin/env python3
"""Scan projects/*/project.json and report any genre not in the new catalog.

Exits 0 if all project genres are valid; exits 1 with a list of unknown ids otherwise.
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
PROJECTS_DIR = REPO_ROOT / "projects"


def main() -> int:
    sys.path.insert(0, str(REPO_ROOT))
    from backend.genres.catalog import get_catalog
    valid_ids = {e["id"] for e in get_catalog().list(ui_visible_only=False)}

    unknown: list[tuple[str, str]] = []
    if not PROJECTS_DIR.exists():
        print(f"No projects directory at {PROJECTS_DIR}; nothing to validate.")
        return 0

    for proj_dir in sorted(PROJECTS_DIR.iterdir()):
        if not proj_dir.is_dir():
            continue
        project_json = proj_dir / "project.json"
        if not project_json.exists():
            continue
        try:
            data = json.loads(project_json.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"WARN: {project_json} is not valid JSON: {e}")
            continue
        genre = data.get("genre")
        if genre and genre not in valid_ids:
            unknown.append((proj_dir.name, genre))

    if unknown:
        print(f"FAIL: {len(unknown)} projects have genres not in catalog:")
        for pid, genre in unknown:
            print(f"  {pid}: genre='{genre}'")
        return 1
    print("OK: all project genres are in catalog.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
