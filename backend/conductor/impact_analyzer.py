"""StoryForge v1.6 Phase 3b — ImpactAnalyzer for rollback impact propagation."""
import hashlib
import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)

MONITORED_FILES = ["story_dna.json", "world.json", "characters.json", "outline.json"]


class ImpactPriority(str, Enum):
    P0_MUST_REWRITE = "P0"
    P1_SUGGEST_REVIEW = "P1"
    P2_NO_IMPACT = "P2"


@dataclass
class ImpactEntry:
    chapter_number: int          # 0 = all chapters
    scene_numbers: list[int]     # reserved for future SF_LOG scanning
    priority: ImpactPriority
    reason: str
    affected_assets: list[str]


@dataclass
class ImpactReport:
    project_id: str
    modified_files: list[str]
    entries: list[ImpactEntry]
    summary: dict[str, int]      # {"P0": n, "P1": n, "P2": n}


class ImpactAnalyzer:
    """
    Deterministic rollback impact calculator. Zero LLM calls.

    Compares current file hashes against a baseline manifest to detect
    STAGE 1-3 setup file changes, then classifies impact as P0/P1/P2
    based on which file changed and (for outline) the nature of the change.
    """

    def __init__(self, projects_dir: Optional[Path] = None):
        self._projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir

    # --- Public API ---

    def analyze(
        self,
        project_id: str,
        modified_files: Optional[list[str]] = None,
    ) -> ImpactReport:
        """
        Analyze impact of file changes vs baseline.

        Args:
            project_id: Project identifier
            modified_files: Specific files to check (None = auto-detect all 4)

        Returns:
            ImpactReport with classified entries and summary counts
        """
        baseline = self._load_baseline(project_id)
        if not baseline:
            return ImpactReport(
                project_id=project_id,
                modified_files=[],
                entries=[],
                summary={"P0": 0, "P1": 0, "P2": 0},
            )

        files_to_check = modified_files or MONITORED_FILES

        entries: list[ImpactEntry] = []
        modified: list[str] = []

        for fname in files_to_check:
            current_hash = self._compute_file_hash(project_id, fname)
            if not current_hash:
                continue

            baseline_hash = baseline.get(fname, "")
            if current_hash == baseline_hash:
                continue

            modified.append(fname)
            file_entries = self._classify(project_id, fname)
            entries.extend(file_entries)

        summary = {
            "P0": sum(1 for e in entries if e.priority == ImpactPriority.P0_MUST_REWRITE),
            "P1": sum(1 for e in entries if e.priority == ImpactPriority.P1_SUGGEST_REVIEW),
            "P2": sum(1 for e in entries if e.priority == ImpactPriority.P2_NO_IMPACT),
        }

        return ImpactReport(
            project_id=project_id,
            modified_files=modified,
            entries=entries,
            summary=summary,
        )

    def ensure_baseline(self, project_id: str) -> bool:
        """
        Create baseline manifest if it doesn't exist. Idempotent.

        Also saves baseline_outline_snapshot.json for outline content comparison.

        Returns True if baseline was created, False if already existed.
        """
        manifest_path = self._baseline_path(project_id)
        if manifest_path.exists():
            return False

        manifest = {}
        for fname in MONITORED_FILES:
            h = self._compute_file_hash(project_id, fname)
            if h:
                manifest[fname] = h

        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = manifest_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        tmp.replace(manifest_path)

        self._save_outline_snapshot(project_id)

        logger.info("Baseline manifest created for project=%s", project_id)
        return True

    def update_baseline(self, project_id: str) -> None:
        """Update baseline manifest with current file hashes (confirm action)."""
        manifest_path = self._baseline_path(project_id)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)

        manifest = {}
        for fname in MONITORED_FILES:
            h = self._compute_file_hash(project_id, fname)
            if h:
                manifest[fname] = h

        tmp = manifest_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        tmp.replace(manifest_path)

        self._save_outline_snapshot(project_id)

        logger.info("Baseline manifest updated for project=%s", project_id)

    def has_baseline(self, project_id: str) -> bool:
        """Check if baseline manifest exists."""
        return self._baseline_path(project_id).exists()

    def project_exists(self, project_id: str) -> bool:
        """Check if project directory exists."""
        return (self._projects_dir / project_id).is_dir()

    # --- Internal ---

    def _baseline_path(self, project_id: str) -> Path:
        return self._projects_dir / project_id / "baseline_manifest.json"

    def _save_outline_snapshot(self, project_id: str) -> None:
        """Save current outline.json as baseline snapshot for content comparison."""
        outline = self._read_project_json(project_id, "outline.json")
        if not outline:
            return
        snap_path = self._projects_dir / project_id / "baseline_outline_snapshot.json"
        tmp = snap_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(outline, f, ensure_ascii=False, indent=2)
        tmp.replace(snap_path)

    def _read_project_json(self, project_id: str, filename: str) -> Optional[dict]:
        """Read a JSON file from the project directory. Returns None on failure."""
        file_path = self._projects_dir / project_id / filename
        if not file_path.exists():
            return None
        try:
            return json.loads(file_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Failed to read %s/%s: %s", project_id, filename, e)
            return None

    def _load_baseline(self, project_id: str) -> dict[str, str]:
        path = self._baseline_path(project_id)
        if not path.exists():
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Failed to load baseline for %s: %s", project_id, e)
            return {}

    def _compute_file_hash(self, project_id: str, filename: str) -> str:
        """Compute SHA256 hash of a project file. Returns empty string on failure."""
        file_path = self._projects_dir / project_id / filename
        if not file_path.exists():
            return ""
        try:
            content = file_path.read_bytes()
            return hashlib.sha256(content).hexdigest()
        except Exception as e:
            logger.warning("Failed to hash %s/%s: %s", project_id, filename, e)
            return ""

    def _classify(self, project_id: str, filename: str) -> list[ImpactEntry]:
        """Classify impact of a changed file. Delegates to specific handlers."""
        if filename == "story_dna.json":
            return self._classify_story_dna()
        elif filename in ("world.json", "characters.json"):
            return self._classify_setting(filename)
        elif filename == "outline.json":
            return self._classify_outline(project_id)
        return []

    def _classify_story_dna(self) -> list[ImpactEntry]:
        return [ImpactEntry(
            chapter_number=0,
            scene_numbers=[],
            priority=ImpactPriority.P0_MUST_REWRITE,
            reason="story_dna.json 已变更，核心设定修改可能影响全部已完成章节",
            affected_assets=["story_dna.json"],
        )]

    def _classify_setting(self, filename: str) -> list[ImpactEntry]:
        label = "角色设定" if filename == "characters.json" else "世界规则"
        return [ImpactEntry(
            chapter_number=0,
            scene_numbers=[],
            priority=ImpactPriority.P1_SUGGEST_REVIEW,
            reason=f"{filename} 已变更，{label}修改可能影响所有已完成场景",
            affected_assets=[filename],
        )]

    def _classify_outline(self, project_id: str) -> list[ImpactEntry]:
        """Compare outline chapter lists to determine P1 (delete/reorder) vs P2 (add only)."""
        # Read current outline
        current_data = self._read_project_json(project_id, "outline.json") or {}
        current_chapters = current_data.get("chapters", [])
        current_numbers = [ch.get("chapter_number") for ch in current_chapters if ch.get("chapter_number")]

        # Read baseline outline snapshot for content comparison
        old_outline_path = self._projects_dir / project_id / "baseline_outline_snapshot.json"
        if old_outline_path.exists():
            try:
                old_data = json.loads(old_outline_path.read_text(encoding="utf-8"))
                old_numbers = [ch.get("chapter_number") for ch in old_data.get("chapters", []) if ch.get("chapter_number")]
                return self._compare_outline_changes(old_numbers, current_numbers)
            except Exception:
                pass

        # Fallback: without old snapshot, treat as P1 (conservative)
        return [ImpactEntry(
            chapter_number=0,
            scene_numbers=[],
            priority=ImpactPriority.P1_SUGGEST_REVIEW,
            reason="outline.json 已变更，无法判断是否为纯新增章节，建议复核",
            affected_assets=["outline.json"],
        )]

    def _compare_outline_changes(
        self, old_numbers: list[int], new_numbers: list[int]
    ) -> list[ImpactEntry]:
        """Compare old vs new chapter number lists."""
        old_set = set(old_numbers)
        new_set = set(new_numbers)
        removed = old_set - new_set

        if removed:
            return [ImpactEntry(
                chapter_number=0,
                scene_numbers=[],
                priority=ImpactPriority.P1_SUGGEST_REVIEW,
                reason=f"outline.json 已删除或重排章节（基线章号: {sorted(old_numbers)}，当前: {sorted(new_numbers)}）",
                affected_assets=["outline.json"],
            )]

        # Check order
        if old_numbers != new_numbers[:len(old_numbers)]:
            return [ImpactEntry(
                chapter_number=0,
                scene_numbers=[],
                priority=ImpactPriority.P1_SUGGEST_REVIEW,
                reason="outline.json 章节顺序已变更",
                affected_assets=["outline.json"],
            )]

        # Only additions
        added = new_set - old_set
        return [ImpactEntry(
            chapter_number=0,
            scene_numbers=[],
            priority=ImpactPriority.P2_NO_IMPACT,
            reason=f"outline.json 仅新增章节（新增章号: {sorted(added)}），不影响已完成内容",
            affected_assets=["outline.json"],
        )]
