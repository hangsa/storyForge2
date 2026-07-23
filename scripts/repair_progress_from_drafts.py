"""Repair progress.json scenes that are stuck at status="retry" because of a
streaming-path bug (CircuitBreaker.check(attempt=1) returning "retry" on Fact
Guard failure — single-pass streaming has no retry loop, so the text was kept
and draft.md was written, but progress.json got "retry").

Walks every scene with status="retry" in the project's progress.json; if the
matching chapters/chXX_scene_YYY_draft.md exists on disk, flips scene.status
to "completed" and recomputes chapter.status from the per-scene statuses.
Idempotent — running twice is a no-op once scenes have been flipped.

Usage:
    python scripts/repair_progress_from_drafts.py <project_id>
    python scripts/repair_progress_from_drafts.py <project_id> --apply
    python scripts/repair_progress_from_drafts.py <project_id> --projects-dir .

Default is dry-run; pass --apply to write. The script also writes a backup to
progress.json.bak before the first apply, in case rollback is needed.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

# Repo-root import — lets this script run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import settings  # noqa: E402
from backend.utils.file_manager import FileManager  # noqa: E402

DONE_STATUSES = {"completed", "force_passed", "skipped"}


def _draft_path(project_dir: Path, chapter: int, scene: int) -> Path:
    return project_dir / "chapters" / f"ch{chapter:02d}_scene_{scene:03d}_draft.md"


def repair(projects_dir: Path, project_id: str, apply: bool) -> dict:
    fm = FileManager(projects_dir)
    progress_path = fm.project_path(project_id, "progress.json")
    if not progress_path.exists():
        return {"error": "progress.json not found", "project_id": project_id}

    project_dir = projects_dir / project_id
    progress = json.loads(progress_path.read_text(encoding="utf-8"))

    scene_changes: list[tuple[int, int, str]] = []  # (chapter, scene, old_status)
    chapter_changes: list[tuple[int, str]] = []      # (chapter, old_status)

    for ch in progress.get("chapters", []):
        ch_num = ch.get("chapter_number")
        for scene in ch.get("scenes", []):
            if scene.get("status") != "retry":
                continue
            draft = _draft_path(project_dir, ch_num, scene.get("scene_number"))
            if draft.exists():
                scene_changes.append((ch_num, scene.get("scene_number"), "retry"))

    # Compute new chapter statuses after scene flips.
    flip_set = {(c, sn) for (c, sn, _old) in scene_changes}
    new_chapter_statuses: dict[int, str] = {}
    for ch in progress.get("chapters", []):
        ch_num = ch.get("chapter_number")
        all_done = all(
            s.get("status") in DONE_STATUSES or (ch_num, s.get("scene_number")) in flip_set
            for s in ch.get("scenes", [])
        )
        if ch.get("status") == "in_progress" and all_done:
            chapter_changes.append((ch_num, "in_progress"))
            new_chapter_statuses[ch_num] = "completed"

    old_current = progress.get("current_chapter", 1) or 1
    new_current = old_current
    if chapter_changes:
        new_current = max(old_current, max(c for c, _ in chapter_changes) + 1)
    current_chapter_change = new_current != old_current

    summary = {
        "project_id": project_id,
        "scene_flips": len(scene_changes),
        "chapter_flips": len(chapter_changes),
        "current_chapter": {"old": old_current, "new": new_current} if current_chapter_change else None,
        "applied": False,
        "backup": None,
    }

    if not apply:
        return {**summary, "dry_run": True,
                "scene_change_list": scene_changes,
                "chapter_change_list": chapter_changes}

    # Apply.
    backup_path = progress_path.with_suffix(".json.bak")
    if not backup_path.exists():
        shutil.copy2(progress_path, backup_path)
        summary["backup"] = str(backup_path)

    for ch in progress.get("chapters", []):
        ch_num = ch.get("chapter_number")
        for scene in ch.get("scenes", []):
            if (ch_num, scene.get("scene_number")) in flip_set:
                scene["status"] = "completed"
        if ch_num in new_chapter_statuses:
            ch["status"] = new_chapter_statuses[ch_num]
    if current_chapter_change:
        progress["current_chapter"] = new_current

    fm.write_json(project_id, "progress.json", progress)
    summary["applied"] = True
    summary["scene_change_list"] = scene_changes
    summary["chapter_change_list"] = chapter_changes
    return summary


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("project_id", help="e.g. proj_a601cee9")
    p.add_argument("--projects-dir", default=str(settings.projects_dir),
                   help=f"projects root (default: {settings.projects_dir})")
    p.add_argument("--apply", action="store_true",
                   help="Write changes (default is dry-run).")
    args = p.parse_args()

    projects_dir = Path(args.projects_dir).resolve()
    if not projects_dir.exists():
        print(f"ERROR: projects-dir does not exist: {projects_dir}", file=sys.stderr)
        return 2

    result = repair(projects_dir, args.project_id, apply=args.apply)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())