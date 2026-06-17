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


class TestSFLogScanning:
    """Tests for _scan_sf_logs_for_changes — scene-level impact via SF_LOG tags."""

    @pytest.fixture
    def analyzer(self, tmp_path):
        projects_dir = tmp_path / "projects"
        return ImpactAnalyzer(projects_dir=projects_dir)

    @pytest.fixture
    def project_with_drafts(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        chapters_dir = proj_dir / "chapters"
        chapters_dir.mkdir(parents=True)

        # Write setup files
        files = {
            "story_dna.json": {"genre": "cool_novel"},
            "world.json": {"power_system": "test"},
            "characters.json": [
                {"id": "c1", "name": "林峰", "is_core_character": True},
                {"id": "c2", "name": "苏晓晓", "is_core_character": True},
            ],
            "outline.json": {"chapters": [
                {"chapter_number": 1}, {"chapter_number": 2},
            ]},
        }
        for fname, content in files.items():
            (proj_dir / fname).write_text(
                json.dumps(content, ensure_ascii=False), encoding="utf-8")

        return projects_dir, proj_dir, chapters_dir

    def _write_baseline(self, proj_dir):
        import hashlib
        manifest = {}
        for fname in ["story_dna.json", "world.json", "characters.json", "outline.json"]:
            content = (proj_dir / fname).read_text(encoding="utf-8")
            manifest[fname] = hashlib.sha256(content.encode()).hexdigest()
        (proj_dir / "baseline_manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def test_characters_change_scans_sf_logs(self, analyzer, project_with_drafts):
        projects_dir, proj_dir, chapters_dir = project_with_drafts
        self._write_baseline(proj_dir)

        # Write a chapter draft with character SF_LOG tags
        draft = chapters_dir / "ch1_scene_1_draft.md"
        draft.write_text(
            '<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->\n'
            '<!-- SF_LOG character_location_change char="苏晓晓" from="家" to="战场" -->\n'
            '一些正文内容。\n',
            encoding="utf-8",
        )
        draft2 = chapters_dir / "ch2_scene_1_draft.md"
        draft2.write_text(
            '<!-- SF_LOG character_emotion char="林峰" emotion="冷静" -->\n'
            '更多正文。\n',
            encoding="utf-8",
        )

        # Modify characters.json to trigger change detection
        data = json.loads((proj_dir / "characters.json").read_text(encoding="utf-8"))
        data.append({"id": "c3", "name": "新角色"})
        (proj_dir / "characters.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["characters.json"])
        # Should have SF_LOG scan entries with specific scene numbers
        sf_entries = [e for e in report.entries if e.chapter_number != 0]
        assert len(sf_entries) > 0
        # Chapter 1 should have both scenes mentioned
        ch1_entry = next((e for e in sf_entries if e.chapter_number == 1), None)
        assert ch1_entry is not None
        assert 1 in ch1_entry.scene_numbers

    def test_characters_change_no_matching_sf_logs(self, analyzer, project_with_drafts):
        projects_dir, proj_dir, chapters_dir = project_with_drafts
        self._write_baseline(proj_dir)

        # Write a draft that doesn't mention any character names
        draft = chapters_dir / "ch1_scene_1_draft.md"
        draft.write_text(
            '<!-- SF_LOG character_emotion char="路人甲" emotion="开心" -->\n',
            encoding="utf-8",
        )

        data = json.loads((proj_dir / "characters.json").read_text(encoding="utf-8"))
        data.append({"id": "c3", "name": "新角色"})
        (proj_dir / "characters.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["characters.json"])
        # Should have a fallback entry with chapter_number=0
        fallback = [e for e in report.entries if e.chapter_number == 0
                    and "characters.json" in e.affected_assets]
        assert len(fallback) >= 1

    def test_world_change_scans_sf_logs(self, analyzer, project_with_drafts):
        projects_dir, proj_dir, chapters_dir = project_with_drafts
        self._write_baseline(proj_dir)

        draft = chapters_dir / "ch1_scene_1_draft.md"
        draft.write_text(
            '<!-- SF_LOG knowledge_gain char="林峰" content="世界真相" source="古书" -->\n'
            '<!-- SF_LOG registry_create type="cost" data=\'{"amount":"大量"}\' -->\n',
            encoding="utf-8",
        )

        data = json.loads((proj_dir / "world.json").read_text(encoding="utf-8"))
        data["power_system"] = "modified"
        (proj_dir / "world.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["world.json"])
        sf_entries = [e for e in report.entries if e.chapter_number != 0]
        assert len(sf_entries) > 0
        ch1_entry = next((e for e in sf_entries if e.chapter_number == 1), None)
        assert ch1_entry is not None
        assert "world.json" in ch1_entry.affected_assets

    def test_outline_change_flags_all_scenes(self, analyzer, project_with_drafts):
        projects_dir, proj_dir, chapters_dir = project_with_drafts
        self._write_baseline(proj_dir)

        draft1 = chapters_dir / "ch1_scene_1_draft.md"
        draft1.write_text("第一章内容", encoding="utf-8")
        draft2 = chapters_dir / "ch2_scene_1_draft.md"
        draft2.write_text("第二章内容", encoding="utf-8")

        data = json.loads((proj_dir / "outline.json").read_text(encoding="utf-8"))
        data["chapters"].append({"chapter_number": 3})
        (proj_dir / "outline.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["outline.json"])
        sf_entries = [e for e in report.entries if e.chapter_number != 0
                      and "outline.json" in e.affected_assets]
        # Should flag both chapters 1 and 2
        chapters_found = {e.chapter_number for e in sf_entries}
        assert 1 in chapters_found
        assert 2 in chapters_found

    def test_no_drafts_returns_empty(self, analyzer, project_with_drafts):
        projects_dir, proj_dir, chapters_dir = project_with_drafts
        self._write_baseline(proj_dir)

        data = json.loads((proj_dir / "characters.json").read_text(encoding="utf-8"))
        data.append({"id": "c3", "name": "新角色"})
        (proj_dir / "characters.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")

        report = analyzer.analyze("test_proj", modified_files=["characters.json"])
        # No drafts exist — scan returns empty (no crash)
        assert isinstance(report.entries, list)
