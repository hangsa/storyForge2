"""Backfill `voice_signature.behavior_examples` for existing characters.

Walks one or all projects and, for every character whose
`voice_signature.behavior_examples` is missing or empty, re-runs the
Character Designer (PlannerAgent.generate_character) and merges the resulting
`behavior_examples` back into the character dict on disk.

Features:
- --dry-run             Plan only; no writes (also no LLM calls).
- --projects-dir DIR    Override project root (default: current directory).
- --project-id ID       Target a single project; otherwise walk all dirs.
- --batch-size N        Hint, currently sequential (reserved for future use).
- --include-examples    Also re-run on characters that already have examples.

Resumability:
- Per-project `.backfill_progress.json` records completed character IDs so a
  kill+resume does not re-LLM done characters.

Idempotency:
- Characters with non-empty `behavior_examples` are skipped (unless
  --include-examples is set).
- `characters.json` is only written if at least one character was filled.

Usage:
    python scripts/backfill_behavior_examples.py --dry-run
    python scripts/backfill_behavior_examples.py --project-id proj_7cb0180f
    python scripts/backfill_behavior_examples.py --projects-dir /path/to/projects
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Awaitable, Callable, Optional

# Type alias for the optional LLM stub. A stub is any async callable with the
# same signature as PlannerAgent.generate_character; it lets the test harness
# bypass the real LLM across subprocess boundaries.
LLMStub = Callable[..., Awaitable[tuple[dict, object]]]

# Repo-root import — lets this script run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.models.character import BehaviorExample  # noqa: E402
from backend.services.agent_prompt_stores import (  # noqa: E402
    project_override_store,
    global_override_store,
)


PROGRESS_FILENAME = ".backfill_progress.json"


def _is_project_dir(p: Path) -> bool:
    """Heuristic: a directory containing characters.json is a project."""
    return p.is_dir() and (p / "characters.json").is_file()


def _load_progress(project_dir: Path) -> dict:
    progress_path = project_dir / PROGRESS_FILENAME
    if not progress_path.is_file():
        return {"completed_ids": []}
    try:
        return json.loads(progress_path.read_text(encoding="utf-8"))
    except Exception:
        # Corrupt progress file — treat as empty rather than aborting the run.
        return {"completed_ids": []}


def _save_progress(project_dir: Path, completed_ids: list[str]) -> None:
    progress_path = project_dir / PROGRESS_FILENAME
    progress_path.write_text(
        json.dumps({"completed_ids": completed_ids}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _has_behavior_examples(char: dict) -> bool:
    vs = char.get("voice_signature") or {}
    examples = vs.get("behavior_examples")
    return isinstance(examples, list) and len(examples) > 0


def _extract_examples(result: dict) -> list[dict]:
    """Pull behavior_examples from a PlannerAgent response, accepting either
    top-level `behavior_examples` or `voice_signature.behavior_examples`.

    Validates each entry via BehaviorExample.model_dump; malformed entries
    are skipped (we never want a bad LLM payload to poison the on-disk dict).
    """
    raw = result.get("behavior_examples")
    if not raw:
        raw = (result.get("voice_signature") or {}).get("behavior_examples", [])
    out: list[dict] = []
    for ex in raw or []:
        if not isinstance(ex, dict):
            continue
        try:
            out.append(BehaviorExample(**ex).model_dump())
        except Exception:
            continue
    return out


def _read_json_safe(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


async def _fill_character(
    project_id: str,
    char: dict,
    concept_and_dna: dict,
    world: dict,
    dry_run: bool,
    llm_stub: Optional["LLMStub"] = None,
) -> list[dict]:
    """Run PlannerAgent.generate_character for one character and return its
    new behavior_examples (empty list on failure or in dry-run).

    `llm_stub` (test-only): a callable with the same signature as
    PlannerAgent.generate_character that bypasses the real LLM call. Used
    by the test harness to avoid LLM costs across subprocess boundaries.
    """
    if dry_run:
        return []
    if llm_stub is not None:
        try:
            result, _resp = await llm_stub(
                concept=concept_and_dna.get("concept", {}),
                world=world,
                character_type=char.get("character_type", "supporting"),
                existing_characters=[char],
            )
            return _extract_examples(result)
        except Exception as e:
            print(f"  [WARN] llm_stub failed for {char.get('id', '?')}: {e}")
            return []

    # Local import so the test patch on `backend.agents.planner.PlannerAgent`
    # intercepts correctly.
    from backend.agents.planner import PlannerAgent

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    try:
        result, _resp = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
            character_type=char.get("character_type", "supporting"),
            existing_characters=[char],
        )
    except Exception as e:  # ValueError on missing key, etc.
        print(f"  [WARN] generate_character failed for {char.get('id', '?')}: {e}")
        return []
    return _extract_examples(result)


def _resolve_llm_stub(spec: Optional[str]):
    """Resolve a 'module:function' spec into a callable. Returns None if spec
    is falsy. Raises ValueError on resolution failure."""
    if not spec:
        return None
    if ":" not in spec:
        raise ValueError(f"--llm-stub must be 'module:function', got: {spec!r}")
    module_name, func_name = spec.split(":", 1)
    import importlib
    module = importlib.import_module(module_name)
    func = getattr(module, func_name, None)
    if func is None:
        raise ValueError(f"function {func_name!r} not found in module {module_name!r}")
    return func


def _discover_projects(projects_dir: Path, project_id: Optional[str]) -> list[Path]:
    if project_id:
        target = projects_dir / project_id
        if not _is_project_dir(target):
            print(f"[ERROR] project not found or missing characters.json: {target}")
            return []
        return [target]
    return sorted(p for p in projects_dir.iterdir() if _is_project_dir(p))


async def _process_project(
    project_dir: Path,
    dry_run: bool,
    include_examples: bool,
    batch_size: int,  # reserved
    llm_stub: Optional[LLMStub] = None,
) -> dict:
    """Process one project. Returns a small stats dict for reporting."""
    project_id = project_dir.name
    stats = {
        "project_id": project_id,
        "scanned": 0,
        "filled": 0,
        "skipped_existing": 0,
        "skipped_progress": 0,
        "failed": 0,
        "dry_run": dry_run,
    }
    characters_path = project_dir / "characters.json"
    data = _read_json_safe(characters_path)
    if not data:
        print(f"[SKIP] {project_id}: empty or missing characters.json")
        return stats
    characters: list[dict] = data.get("characters", []) or []

    progress = _load_progress(project_dir)
    completed_ids: list[str] = set(progress.get("completed_ids", []) or [])

    concept_and_dna = _read_json_safe(project_dir / "concept_and_dna.json")
    world = _read_json_safe(project_dir / "world.json")

    dirty = False
    for char in characters:
        stats["scanned"] += 1
        cid = char.get("id", "")
        if not cid:
            stats["failed"] += 1
            continue
        if cid in completed_ids:
            stats["skipped_progress"] += 1
            continue
        if not include_examples and _has_behavior_examples(char):
            stats["skipped_existing"] += 1
            completed_ids.add(cid)  # also mark complete so we don't re-check
            continue

        new_examples = await _fill_character(
            project_id, char, concept_and_dna, world, dry_run, llm_stub,
        )
        if not new_examples:
            if dry_run:
                # In dry-run _fill_character short-circuits and returns [] —
                # the would-be fill is still planned, not a real failure.
                print(f"  [DRY RUN] would fill {cid}")
                stats["filled"] += 1
            else:
                stats["failed"] += 1
            continue

        vs = char.setdefault("voice_signature", {})
        vs["behavior_examples"] = new_examples
        stats["filled"] += 1
        dirty = True
        completed_ids.add(cid)
        print(f"  [OK] {cid} ({char.get('name', '')}): +{len(new_examples)} example(s)")

    if not dry_run and dirty:
        # Sort for stable file diffs.
        characters_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        _save_progress(project_dir, sorted(completed_ids))
        print(f"  [WRITE] {characters_path.relative_to(project_dir.parent)}")
    elif not dirty and not dry_run:
        # No fills but we still want progress recorded for skipped_existing
        # so a future run sees them as completed.
        _save_progress(project_dir, sorted(completed_ids))

    return stats


async def amain(args: argparse.Namespace) -> int:
    projects_dir: Path = args.projects_dir.resolve()
    if not projects_dir.is_dir():
        print(f"[ERROR] --projects-dir not a directory: {projects_dir}")
        return 2

    project_dirs = _discover_projects(projects_dir, args.project_id)
    if not project_dirs:
        return 1

    print(f"[INFO] projects_dir={projects_dir}")
    print(f"[INFO] projects to process: {len(project_dirs)}")
    print(f"[INFO] mode: {'DRY RUN' if args.dry_run else 'APPLY'}")
    print()

    total_filled = 0
    total_failed = 0
    llm_stub = _resolve_llm_stub(args.llm_stub)
    for project_dir in project_dirs:
        print(f"[PROJECT] {project_dir.name}")
        stats = await _process_project(
            project_dir,
            dry_run=args.dry_run,
            include_examples=args.include_examples,
            batch_size=args.batch_size,
            llm_stub=llm_stub,
        )
        print(
            f"  scanned={stats['scanned']} filled={stats['filled']} "
            f"skipped_existing={stats['skipped_existing']} "
            f"skipped_progress={stats['skipped_progress']} "
            f"failed={stats['failed']}"
        )
        print()
        total_filled += stats["filled"]
        total_failed += stats["failed"]

    print(f"[DONE] total filled={total_filled} failed={total_failed}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill behavior_examples for existing characters.",
    )
    parser.add_argument(
        "--projects-dir",
        type=Path,
        default=Path("."),
        help="Projects root directory (default: current dir).",
    )
    parser.add_argument(
        "--project-id",
        type=str,
        default=None,
        help="Target a single project. Default: walk all project dirs.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan only; no writes and no LLM calls.",
    )
    parser.add_argument(
        "--include-examples",
        action="store_true",
        help="Also re-run on characters that already have examples.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Hint, currently sequential (reserved for future parallelism).",
    )
    parser.add_argument(
        "--llm-stub",
        type=str,
        default=None,
        help=(
            "Test-only: 'module:function' to use as a stub in place of "
            "PlannerAgent.generate_character. The stub must be an async "
            "callable with the same signature."
        ),
    )
    args = parser.parse_args()
    return asyncio.run(amain(args))


if __name__ == "__main__":
    sys.exit(main())