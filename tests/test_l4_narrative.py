"""Tests for L4NarrativeMemory (Phase 2.4)."""

import json
import pytest
from backend.memory_os.l4_narrative import L4NarrativeMemory


class TestL4NarrativeMemory:
    @pytest.fixture
    def setup_l4(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        storyos_dir = proj_dir / "storyos"
        l2_dir = proj_dir / "memory" / "l2"
        l4_dir = proj_dir / "memory" / "l4"
        for d in [storyos_dir, l2_dir, l4_dir]:
            d.mkdir(parents=True)

        l4 = L4NarrativeMemory("test_proj", projects_dir=projects_dir)
        return l4, storyos_dir, l2_dir

    def test_sync_from_empty_registries(self, setup_l4):
        l4, storyos_dir, l2_dir = setup_l4
        # No registry files exist — should not crash
        l4.sync_from_registries(chapter_number=3)
        patterns_path = l4._l4_dir / "narrative_patterns.json"
        assert patterns_path.exists()
        patterns = json.loads(patterns_path.read_text())
        assert patterns["chapter_number"] == 3
        assert "asset_counts" in patterns
        # All registries should have total=0
        for asset_type, data in patterns["asset_counts"].items():
            assert data["total"] == 0

    def test_sync_with_registry_data(self, setup_l4):
        l4, storyos_dir, l2_dir = setup_l4

        # Write some registry files
        conflicts = [
            {"id": "cf_001", "status": "active", "intensity": "critical"},
            {"id": "cf_002", "status": "resolved"},
        ]
        storyos_dir.joinpath("conflicts.json").write_text(json.dumps(conflicts))

        mysteries = [
            {"id": "mys_001", "status": "open"},
            {"id": "mys_002", "status": "open"},
            {"id": "mys_003", "status": "revealed"},
        ]
        storyos_dir.joinpath("mysteries.json").write_text(json.dumps(mysteries))

        # L2 active narrative state
        l2_state = {
            "unresolved_conflicts": ["cf_001"],
            "open_mysteries": ["mys_001", "mys_002"],
            "pending_promises": ["pr_001"],
        }
        l2_dir.joinpath("active_narrative_state.json").write_text(json.dumps(l2_state))

        l4.sync_from_registries(chapter_number=5)

        patterns_path = l4._l4_dir / "narrative_patterns.json"
        patterns = json.loads(patterns_path.read_text())

        assert patterns["asset_counts"]["conflict"]["total"] == 2
        assert patterns["asset_counts"]["mystery"]["total"] == 3
        assert patterns["narrative_state"]["unresolved_conflicts"] == ["cf_001"]
        assert patterns["narrative_state"]["open_mysteries"] == ["mys_001", "mys_002"]

    def test_context_string_empty_when_no_data(self, setup_l4):
        l4, storyos_dir, l2_dir = setup_l4
        result = l4.get_context_string()
        assert result == ""

    def test_context_string_structure(self, setup_l4):
        l4, storyos_dir, l2_dir = setup_l4

        # Write minimal data to produce context
        conflicts = [{"id": "cf_001", "status": "active"}]
        storyos_dir.joinpath("conflicts.json").write_text(json.dumps(conflicts))
        l2_state = {"unresolved_conflicts": ["cf_001"]}
        l2_dir.joinpath("active_narrative_state.json").write_text(json.dumps(l2_state))

        l4.sync_from_registries(chapter_number=2)
        result = l4.get_context_string()

        assert "叙事资产状态" in result
        assert "当前叙事状态" in result

    def test_foreshadowing_health(self, setup_l4):
        l4, storyos_dir, l2_dir = setup_l4

        fs = [
            {"id": "fs_001", "status": "planted", "created_chapter": 1, "clues": []},
            {"id": "fs_002", "status": "revealed", "created_chapter": 3, "clues": [{}]},
        ]
        storyos_dir.joinpath("foreshadowing.json").write_text(json.dumps(fs))

        l4.sync_from_registries(chapter_number=10)
        patterns = json.loads(l4._l4_dir.joinpath("narrative_patterns.json").read_text())

        health = patterns["foreshadowing_health"]
        assert health["by_status"]["planted"] == 1
        assert health["by_status"]["revealed"] == 1
        # fs_001: planted since ch1, now ch10, 0 clues → stale
        assert health["stale_count"] >= 1
        assert "fs_001" in health["stale_without_clues"]
