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
            "story_dna.json": {"genre": "cool_novel", "premise": "test premise"},
            "world.json": {"power_system": "test system"},
            "characters.json": [{"name": "protagonist"}],
            "outline.json": {"chapters": [
                {"chapter_number": 1, "title": "Chapter 1"},
                {"chapter_number": 2, "title": "Chapter 2"},
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
        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "different premise"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        h2 = analyzer._compute_file_hash("test_proj", "story_dna.json")
        assert h1 != h2

    def test_hash_missing_file_returns_empty(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        h = analyzer._compute_file_hash("test_proj", "nonexistent.json")
        assert h == ""

    def test_story_dna_change_is_p0(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "completely different"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["story_dna.json"])
        assert report.summary["P0"] >= 1
        assert any(e.priority == ImpactPriority.P0_MUST_REWRITE for e in report.entries)

    def test_world_change_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "world.json").read_text(encoding="utf-8"))
        data["power_system"] = "modified system"
        (proj_dir / "world.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["world.json"])
        assert report.summary["P1"] >= 1

    def test_character_change_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        data = json.loads((proj_dir / "characters.json").read_text(encoding="utf-8"))
        data.append({"name": "new character"})
        (proj_dir / "characters.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["characters.json"])
        assert report.summary["P1"] >= 1

    def test_outline_add_chapter_is_p2(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        # Also write the baseline outline snapshot for content comparison
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        (proj_dir / "baseline_outline_snapshot.json").write_text(
            json.dumps(outline, ensure_ascii=False), encoding="utf-8")
        # Now add a new chapter
        outline["chapters"].append({"chapter_number": 3, "title": "New Chapter"})
        (proj_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        assert report.summary["P2"] >= 1
        assert report.summary["P1"] == 0

    def test_outline_delete_chapter_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        (proj_dir / "baseline_outline_snapshot.json").write_text(
            json.dumps(outline, ensure_ascii=False), encoding="utf-8")
        outline["chapters"] = outline["chapters"][:1]  # remove chapter 2
        (proj_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        assert report.summary["P1"] >= 1

    def test_outline_reorder_chapter_is_p1(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        self._write_baseline(proj_dir, ["story_dna.json", "world.json", "characters.json", "outline.json"])
        outline = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        (proj_dir / "baseline_outline_snapshot.json").write_text(
            json.dumps(outline, ensure_ascii=False), encoding="utf-8")
        outline["chapters"].reverse()
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
        report = analyzer.analyze("test_proj")
        assert report.summary["P0"] == 0
        assert report.summary["P1"] == 0
        assert report.summary["P2"] == 0
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
        analyzer.ensure_baseline("test_proj")
        h2 = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]
        assert h1 == h2

    def test_update_baseline(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        analyzer.ensure_baseline("test_proj")
        old_hash = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]

        data = json.loads((proj_dir / "story_dna.json").read_text(encoding="utf-8"))
        data["premise"] = "new premise"
        (proj_dir / "story_dna.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        analyzer.update_baseline("test_proj")
        new_hash = json.loads((proj_dir / "baseline_manifest.json").read_text(encoding="utf-8"))["story_dna.json"]
        assert old_hash != new_hash

    def test_has_baseline(self, analyzer, project_with_files):
        projects_dir, proj_dir = project_with_files
        assert analyzer.has_baseline("test_proj") is False
        analyzer.ensure_baseline("test_proj")
        assert analyzer.has_baseline("test_proj") is True
