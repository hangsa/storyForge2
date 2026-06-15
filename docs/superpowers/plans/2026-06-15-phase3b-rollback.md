# Phase 3b: Rollback System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ImpactAnalyzer with SHA256 hash-based file change detection and P0/P1/P2 classification, baseline manifest management, and 2 rollback API endpoints.

**Architecture:** New `backend/conductor/impact_analyzer.py` contains the analyzer with zero-LLM hash comparison. Baseline snapshots stored in `projects/{id}/baseline_manifest.json`, created on first STAGE 4 entry. Two new POST endpoints added to existing `backend/api/conductor.py`. Outline classification uses content comparison (chapter number list diff), not just hash.

**Tech Stack:** Python stdlib hashlib (SHA256), FastAPI, existing FileManager

**Files:**
- Create: `backend/conductor/impact_analyzer.py`
- Create: `tests/test_impact_analyzer.py`
- Modify: `backend/api/conductor.py` (add 2 endpoints)
- Modify: `backend/api/stage4_writing.py` (add `ensure_baseline` call in get_progress)
- No change: `backend/main.py` (already imports conductor router)

---

### Task 1: Create ImpactAnalyzer with hash diff and classification

**Files:**
- Create: `backend/conductor/impact_analyzer.py`

- [ ] **Step 1: Write the test file**

Create `tests/test_impact_analyzer.py`:

```python
"""Tests for ImpactAnalyzer (Phase 3b)."""
import json
import pytest
from backend.conductor.impact_analyzer import (
    ImpactAnalyzer,
    ImpactPriority,
    ImpactEntry,
    ImpactReport,
)


class TestImpactPriority:
    def test_p0_is_most_severe(self):
        assert ImpactPriority.P0_MUST_REWRITE == "P0"
        assert ImpactPriority.P1_SUGGEST_REVIEW == "P1"
        assert ImpactPriority.P2_NO_IMPACT == "P2"


class TestImpactAnalyzer:
    @pytest.fixture
    def analyzer(self, tmp_path):
        projects_dir = tmp_path / "projects"
        return ImpactAnalyzer(projects_dir=projects_dir)

    @pytest.fixture
    def project_with_files(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        proj_dir.mkdir(parents=True)
        # Write current versions
        files = {
            "story_dna.json": {"genre": "cool_novel", "premise": "测试前提"},
            "world.json": {"power_system": "测试体系"},
            "characters.json": [{"name": "主角"}],
            "outline.json": {"chapters": [
                {"chapter_number": 1, "title": "第一章"},
                {"chapter_number": 2, "title": "第二章"},
            ]},
        }
        for fname, content in files.items():
            (proj_dir / fname).write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
        return projects_dir, proj_dir

    def _write_baseline(self, proj_dir, files):
        """Helper: write baseline from current files."""
        import hashlib
        manifest = {}
        for fname in files:
            content = (proj_dir / fname).read_text(encoding="utf-8")
            manifest[fname] = hashlib.sha256(content.encode()).hexdigest()
        (proj_dir / "baseline_manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def test_hash_computation(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        h = analyzer._compute_file_hash("test_proj", "story_dna.json")
        assert isinstance(h, str)
        assert len(h) == 64  # SHA256 hex

    def test_hash_same_content_same_hash(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        h1 = analyzer._compute_file_hash("test_proj", "story_dna.json")
        h2 = analyzer._compute_file_hash("test_proj", "story_dna.json")
        assert h1 == h2

    def test_hash_different_content_different_hash(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        h1 = analyzer._compute_file_hash("test_proj", "story_dna.json")
        # Modify file
        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "不同的前提"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        h2 = analyzer._compute_file_hash("test_proj", "story_dna.json")
        assert h1 != h2

    def test_hash_missing_file_returns_empty(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        h = analyzer._compute_file_hash("test_proj", "nonexistent.json")
        assert h == ""

    # --- Classification tests ---

    def test_story_dna_change_is_p0(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        # Change story_dna.json
        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "完全不同的前提"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["story_dna.json"])
        assert report.summary["P0"] >= 1
        assert any(e.priority == ImpactPriority.P0_MUST_REWRITE for e in report.entries)

    def test_world_change_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "world.json").read_text(encoding="utf-8"))
        data["power_system"] = "修改后的体系"
        (proj_dir / "world.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["world.json"])
        assert report.summary["P1"] >= 1

    def test_character_change_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "characters.json").read_text(encoding="utf-8"))
        data.append({"name": "新角色"})
        (proj_dir / "characters.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["characters.json"])
        assert report.summary["P1"] >= 1

    def test_outline_add_chapter_is_p2(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        outline["chapters"].append({"chapter_number": 3, "title": "新章"})
        (proj_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        assert report.summary["P2"] >= 1
        assert report.summary["P1"] == 0

    def test_outline_delete_chapter_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        outline["chapters"] = outline["chapters"][:1]  # remove chapter 2
        (proj_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        assert report.summary["P1"] >= 1

    def test_outline_reorder_chapter_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        outline["chapters"].reverse()  # swap order
        (proj_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        assert report.summary["P1"] >= 1

    def test_no_changes_detected(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])

        report = analyzer.analyze("test_proj", modified_files=["story_dna.json"])
        assert report.summary["P0"] == 0
        assert report.summary["P1"] == 0
        assert report.summary["P2"] == 0

    def test_auto_detect_modified_files(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "world.json").read_text(encoding="utf-8"))
        data["power_system"] = "changed"
        (proj_dir / "world.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj")  # auto-detect
        assert "world.json" in report.modified_files

    def test_baseline_not_found(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        # No baseline written
        report = analyzer.analyze("test_proj")
        assert report.summary["P0"] == 0
        assert report.summary["P1"] == 0
        assert report.summary["P2"] == 0
        # entries should be empty since no comparison possible
        assert len(report.entries) == 0

    def test_ensure_baseline_creates_if_missing(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        manifest_path = proj_dir / "baseline_manifest.json"
        assert not manifest_path.exists()

        analyzer.ensure_baseline("test_proj")
        assert manifest_path.exists()

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert "story_dna.json" in manifest
        assert len(manifest) == 4

    def test_ensure_baseline_idempotent(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        analyzer.ensure_baseline("test_proj")
        h1 = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]
        # Second call should not overwrite
        analyzer.ensure_baseline("test_proj")
        h2 = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]
        assert h1 == h2

    def test_update_baseline(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        analyzer.ensure_baseline("test_proj")
        old_hash = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]

        # Change a file
        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "新前提"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        analyzer.update_baseline("test_proj")
        new_hash = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]
        assert old_hash != new_hash
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m pytest tests/test_impact_analyzer.py -v 2>&1 | head -5
```

Expected: ImportError (file not created yet).

- [ ] **Step 3: Create `backend/conductor/impact_analyzer.py`**

```python
"""StoryForge v1.6 Phase 3b — ImpactAnalyzer for rollback impact propagation."""
import hashlib
import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.utils.file_manager import FileManager

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
        self._fm = FileManager(self._projects_dir)

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
        logger.info("Baseline manifest updated for project=%s", project_id)

    def has_baseline(self, project_id: str) -> bool:
        """Check if baseline manifest exists."""
        return self._baseline_path(project_id).exists()

    # --- Internal ---

    def _baseline_path(self, project_id: str) -> Path:
        return self._projects_dir / project_id / "baseline_manifest.json"

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
        baseline = self._load_baseline(project_id)
        if not baseline:
            return []

        # Read current outline
        current_data = self._fm.read_json(project_id, "outline.json") or {}
        current_chapters = current_data.get("chapters", [])
        current_numbers = [ch.get("chapter_number") for ch in current_chapters if ch.get("chapter_number")]

        # Read baseline outline (stored by hash only — need to read old version)
        # Since we only have the hash, fall back to comparing chapter numbers
        # from the current file with what was previously in the baseline
        # We read the outline data fresh; the baseline only stores hashes.
        # To detect delete/reorder, we need the OLD outline content.
        # Strategy: check if there's a snapshot of the old outline.
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
```

Note: The outline comparison needs the OLD outline content to compare chapter numbers. The baseline manifest only stores hashes. To support this, `ensure_baseline` and `update_baseline` also need to save a snapshot of `outline.json` at `baseline_outline_snapshot.json`.

Update the `ensure_baseline` and `update_baseline` methods to also save the outline snapshot:

In `ensure_baseline`, after writing the manifest, add:
```python
        # Also save outline snapshot for content comparison
        outline = self._fm.read_json(project_id, "outline.json")
        if outline:
            snap_path = self._projects_dir / project_id / "baseline_outline_snapshot.json"
            tmp2 = snap_path.with_suffix(".tmp")
            with open(tmp2, "w", encoding="utf-8") as f:
                json.dump(outline, f, ensure_ascii=False, indent=2)
            tmp2.replace(snap_path)
```

Same block in `update_baseline`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3 -m pytest tests/test_impact_analyzer.py -v
```

Expected: all tests pass. Fix any failures before committing.

- [ ] **Step 5: Commit**

```bash
git add backend/conductor/impact_analyzer.py tests/test_impact_analyzer.py
git commit -m "feat: add ImpactAnalyzer with SHA256 hash diff and P0/P1/P2 classification"
```

---

### Task 2: Add ensure_baseline call to get_progress

**Files:**
- Modify: `backend/api/stage4_writing.py`

- [ ] **Step 1: Add ensure_baseline call**

In `backend/api/stage4_writing.py`, in the `get_progress` function (around line 508), add at the top of the function body (after the `fm` and `project_id` are available):

```python
async def get_progress(project_id: str):
    # v1.6 Phase 3b: ensure baseline manifest exists on first STAGE 4 entry
    from backend.conductor.impact_analyzer import ImpactAnalyzer
    analyzer = ImpactAnalyzer()
    analyzer.ensure_baseline(project_id)

    progress = fm.read_json(project_id, "progress.json")
    # ... rest unchanged ...
```

- [ ] **Step 2: Verify import works**

```bash
python3 -c "from backend.api.stage4_writing import router; print('Import OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/api/stage4_writing.py
git commit -m "feat: auto-create baseline manifest on STAGE 4 entry"
```

---

### Task 3: Add analyze-impact and execute-rollback endpoints

**Files:**
- Modify: `backend/api/conductor.py` (append new endpoints)

- [ ] **Step 1: Read current file**

Read `backend/api/conductor.py` to understand existing structure.

- [ ] **Step 2: Add two new endpoints at end of file**

```python
# --- v1.6 Phase 3b: Rollback Impact Analysis ---


@router.post("/analyze-impact")
async def analyze_impact(data: dict):
    """
    Analyze impact of STAGE 1-3 setup file changes vs baseline.

    Request: { project_id: string, modified_files?: string[] }
    modified_files is optional; if omitted, auto-detects all 4 monitored files.

    Returns 400 if baseline not found or no changes detected.
    """
    project_id = data.get("project_id", "")
    modified_files = data.get("modified_files")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 不能为空",
                "detail": {},
            },
        )

    from backend.conductor.impact_analyzer import ImpactAnalyzer

    analyzer = ImpactAnalyzer(settings.projects_dir)

    if not analyzer.has_baseline(project_id):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "BASELINE_NOT_FOUND",
                "message": "尚未建立基线快照，请先进入 STAGE 4 写作阶段",
                "detail": {},
            },
        )

    report = analyzer.analyze(project_id, modified_files=modified_files)

    if not report.modified_files:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "NO_CHANGES_DETECTED",
                "message": "所有文件与基线一致，未检测到变更",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"检测到 {len(report.modified_files)} 个文件变更",
        "detail": {
            "project_id": report.project_id,
            "modified_files": report.modified_files,
            "entries": [
                {
                    "chapter_number": e.chapter_number,
                    "scene_numbers": e.scene_numbers,
                    "priority": e.priority.value,
                    "reason": e.reason,
                    "affected_assets": e.affected_assets,
                }
                for e in report.entries
            ],
            "summary": report.summary,
        },
    }


@router.post("/execute-rollback")
async def execute_rollback(data: dict):
    """
    Execute rollback decision.

    Request: { project_id: string, action: "confirm" | "cancel" }
    confirm → update baseline to current file hashes
    cancel  → return guidance message (no file modification)
    """
    project_id = data.get("project_id", "")
    action = data.get("action", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 不能为空",
                "detail": {},
            },
        )

    if action not in ("confirm", "cancel"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_ACTION",
                "message": "action 必须为 'confirm' 或 'cancel'",
                "detail": {},
            },
        )

    from backend.conductor.impact_analyzer import ImpactAnalyzer

    analyzer = ImpactAnalyzer(settings.projects_dir)

    if action == "confirm":
        analyzer.update_baseline(project_id)
        return {
            "error": False,
            "code": "OK",
            "message": "基线已更新，当前设定已接受",
            "detail": {
                "status": "confirmed",
                "baseline_updated": True,
            },
        }
    else:
        return {
            "error": False,
            "code": "OK",
            "message": "请手动将设定文件恢复为修改前的版本，或重新进入 STAGE 1-3 调整设定",
            "detail": {
                "status": "cancelled",
                "baseline_updated": False,
            },
        }
```

- [ ] **Step 3: Verify import and syntax**

```bash
python3 -c "from backend.api.conductor import router; print('Import OK')"
python3 -m py_compile backend/api/conductor.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/api/conductor.py
git commit -m "feat: add analyze-impact and execute-rollback API endpoints"
```

---

### Task 4: End-to-end verification

- [ ] **Step 1: Run impact analyzer tests**

```bash
python3 -m pytest tests/test_impact_analyzer.py -v
```

Expected: all tests pass.

- [ ] **Step 2: Run full regression suite**

```bash
python3 -m pytest tests/ -q --tb=short
```

Expected: 17 pre-existing failures, zero new failures.

- [ ] **Step 3: Commit any regression fixes if needed**

```bash
git add -A
git commit -m "fix: Phase 3b regression fixes"
```
