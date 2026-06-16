"""Tests for ImpactEntry and ImpactReport Pydantic models."""


class TestImpactEntry:
    def test_defaults(self):
        from backend.models.impact_report import ImpactEntry

        entry = ImpactEntry(chapter_number=3)
        assert entry.chapter_number == 3
        assert entry.scene_numbers == []
        assert entry.priority == ""
        assert entry.reason == ""
        assert entry.affected_assets == []

    def test_serialization(self):
        from backend.models.impact_report import ImpactEntry

        entry = ImpactEntry(
            chapter_number=5,
            scene_numbers=[1, 2],
            priority="P0",
            reason="Character consistency break",
            affected_assets=["character_states"],
        )
        data = entry.model_dump()
        assert data["chapter_number"] == 5
        assert data["scene_numbers"] == [1, 2]
        assert data["priority"] == "P0"
        assert data["affected_assets"] == ["character_states"]


class TestImpactReport:
    def test_defaults(self):
        from backend.models.impact_report import ImpactReport

        report = ImpactReport()
        assert report.project_id == ""
        assert report.modified_files == []
        assert report.entries == []
        assert report.summary == {}

    def test_with_entries(self):
        from backend.models.impact_report import ImpactEntry, ImpactReport

        entries = [
            ImpactEntry(chapter_number=1, scene_numbers=[1], priority="P1", reason="test"),
            ImpactEntry(chapter_number=2, scene_numbers=[2, 3], priority="P0", reason="critical"),
        ]
        report = ImpactReport(
            project_id="proj_001",
            modified_files=["backend/models/character.py"],
            entries=entries,
            summary={"P0": 1, "P1": 1},
        )
        data = report.model_dump()
        assert len(data["entries"]) == 2
        assert data["project_id"] == "proj_001"
        assert data["modified_files"] == ["backend/models/character.py"]
        assert data["summary"] == {"P0": 1, "P1": 1}
