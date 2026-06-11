"""
RegistryManager CRUD tests — Conflict, Mystery, Twist, Goal registries.
Covers AC-5: StoryOS registries update correctly.
"""

import json
import tempfile
from pathlib import Path

import pytest

from backend.story_os.registries import RegistryManager


@pytest.fixture
def tmp_project_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def rm(tmp_project_dir):
    return RegistryManager("test_project", projects_dir=tmp_project_dir)


class TestCreate:
    def test_create_new_entry(self, rm):
        assert rm.create("conflict", {"id": "cf_001", "intensity": "low"})
        items = rm.get_all("conflict")
        assert len(items) == 1
        assert items[0]["id"] == "cf_001"

    def test_rejects_duplicate_id(self, rm):
        rm.create("mystery", {"id": "mys_001", "title": "起源之谜"})
        assert not rm.create("mystery", {"id": "mys_001", "title": "重复之谜"})
        assert len(rm.get_all("mystery")) == 1

    def test_create_multiple_registries(self, rm):
        rm.create("conflict", {"id": "cf_001"})
        rm.create("mystery", {"id": "mys_001"})
        rm.create("twist", {"id": "tw_001"})
        rm.create("goal", {"id": "goal_001"})
        assert len(rm.get_all("conflict")) == 1
        assert len(rm.get_all("mystery")) == 1
        assert len(rm.get_all("twist")) == 1
        assert len(rm.get_all("goal")) == 1


class TestRead:
    def test_get_all_empty(self, rm):
        assert rm.get_all("conflict") == []

    def test_get_by_id_found(self, rm):
        rm.create("conflict", {"id": "cf_001", "intensity": "high"})
        item = rm.get_by_id("conflict", "cf_001")
        assert item is not None
        assert item["intensity"] == "high"

    def test_get_by_id_not_found(self, rm):
        assert rm.get_by_id("conflict", "nonexistent") is None


class TestUpdate:
    def test_update_existing_entry(self, rm):
        rm.create("goal", {"id": "goal_001", "progress": "T1"})
        assert rm.update("goal", "goal_001", {"progress": "T3"})
        item = rm.get_by_id("goal", "goal_001")
        assert item["progress"] == "T3"

    def test_update_nonexistent_returns_false(self, rm):
        assert not rm.update("conflict", "nonexistent", {"intensity": "high"})


class TestDelete:
    def test_delete_existing_entry(self, rm):
        rm.create("twist", {"id": "tw_001"})
        assert rm.delete("twist", "tw_001")
        assert len(rm.get_all("twist")) == 0

    def test_delete_nonexistent_returns_false(self, rm):
        assert not rm.delete("conflict", "nonexistent")


class TestExists:
    def test_exists_true(self, rm):
        rm.create("conflict", {"id": "cf_001"})
        assert rm.exists("conflict", "cf_001")

    def test_exists_false(self, rm):
        assert not rm.exists("conflict", "nonexistent")


class TestAddClue:
    def test_add_clue_to_mystery(self, rm):
        rm.create("mystery", {"id": "mys_001", "clues": []})
        assert rm.add_clue("mys_001", {"content": "重要线索"})
        mystery = rm.get_by_id("mystery", "mys_001")
        assert len(mystery["clues"]) == 1
        assert mystery["clues"][0]["content"] == "重要线索"

    def test_add_clue_mystery_not_found(self, rm):
        assert not rm.add_clue("nonexistent", {"content": "线索"})


class TestEscalateConflict:
    def test_escalate_tracks_history(self, rm):
        rm.create("conflict", {"id": "cf_001", "intensity": "low", "escalation_history": []})
        assert rm.escalate_conflict("cf_001", "critical", trigger="发现证据")
        conflict = rm.get_by_id("conflict", "cf_001")
        assert conflict["intensity"] == "critical"
        assert len(conflict["escalation_history"]) == 1
        assert conflict["escalation_history"][0]["from_intensity"] == "low"
        assert conflict["escalation_history"][0]["trigger"] == "发现证据"

    def test_escalate_nonexistent_conflict(self, rm):
        assert not rm.escalate_conflict("nonexistent", "high")


class TestPersistence:
    def test_data_survives_reload(self, tmp_project_dir):
        rm1 = RegistryManager("test_project", projects_dir=tmp_project_dir)
        rm1.create("conflict", {"id": "cf_001", "intensity": "low"})

        rm2 = RegistryManager("test_project", projects_dir=tmp_project_dir)
        items = rm2.get_all("conflict")
        assert len(items) == 1
        assert items[0]["id"] == "cf_001"

    def test_default_registry_type(self, rm):
        """Unknown registry types get a default filename."""
        entries = rm.get_all("nonexistent_type")
        assert entries == []
