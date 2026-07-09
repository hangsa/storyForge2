"""Tests for IdeaPool — creative_os/idea_pool.py"""

import json
import tempfile
from pathlib import Path

import pytest

from backend.creative_os.idea_pool import IdeaPool
from backend.models.creative_os import Idea, IdeaCategory


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def pool(temp_dir):
    return IdeaPool(temp_dir)


@pytest.fixture
def sample_idea():
    return Idea(
        id="idea_001",
        content="主角修炼的功法其实是被篡改过的上古禁术",
        category=IdeaCategory.PLOT,
        source_stage="STAGE_1",
        source_context="概念生成时产生的灵感",
        related_elements=["power_system", "character_林峰"],
        confidence=0.85,
    )


class TestIdeaPoolCRUD:

    def test_add_and_get(self, pool, sample_idea):
        pool.add(sample_idea)
        result = pool.get("idea_001")
        assert result is not None
        assert result.content == sample_idea.content
        assert result.category == IdeaCategory.PLOT

    def test_list_all_active(self, pool, sample_idea):
        archived = Idea(
            id="idea_002", content="archived idea", category=IdeaCategory.SETTING,
            source_stage="MANUAL", source_context="", status="archived"
        )
        pool.add(sample_idea)
        pool.add(archived)
        active = pool.list()
        assert len(active) == 1
        assert active[0].id == "idea_001"

    def test_list_by_category(self, pool, sample_idea):
        setting = Idea(
            id="idea_003", content="setting idea", category=IdeaCategory.SETTING,
            source_stage="MANUAL", source_context=""
        )
        pool.add(sample_idea)
        pool.add(setting)
        results = pool.list(category=IdeaCategory.SETTING)
        assert len(results) == 1
        assert results[0].id == "idea_003"

    def test_list_by_source_stage(self, pool, sample_idea):
        manual = Idea(
            id="idea_004", content="manual idea", category=IdeaCategory.STYLE,
            source_stage="MANUAL", source_context=""
        )
        pool.add(sample_idea)
        pool.add(manual)
        results = pool.list(source_stage="MANUAL")
        assert len(results) == 1
        assert results[0].id == "idea_004"

    def test_update(self, pool, sample_idea):
        pool.add(sample_idea)
        pool.update("idea_001", content="updated content", confidence=0.95)
        result = pool.get("idea_001")
        assert result.content == "updated content"
        assert result.confidence == 0.95

    def test_delete(self, pool, sample_idea):
        pool.add(sample_idea)
        pool.delete("idea_001")
        assert pool.get("idea_001") is None

    def test_promote_and_archive(self, pool, sample_idea):
        pool.add(sample_idea)
        pool.promote("idea_001")
        assert pool.get("idea_001").status == "active"
        pool.archive("idea_001")
        assert pool.get("idea_001").status == "archived"

    def test_filter_by_element(self, pool, sample_idea):
        other = Idea(
            id="idea_005", content="other idea", category=IdeaCategory.WRITING,
            source_stage="STAGE_1", source_context="",
            related_elements=["world_rule", "character_苏晓晓"]
        )
        pool.add(sample_idea)
        pool.add(other)
        results = pool.filter_by_element("character_林峰")
        assert len(results) == 1
        assert results[0].id == "idea_001"

    def test_get_nonexistent_returns_none(self, pool):
        assert pool.get("nonexistent") is None

    def test_update_nonexistent_does_nothing(self, pool):
        pool.update("nonexistent", content="x")  # should not raise

    def test_persistence(self, temp_dir):
        pool1 = IdeaPool(temp_dir)
        pool1.add(Idea(id="idea_010", content="persist test", category=IdeaCategory.PLOT,
                        source_stage="MANUAL", source_context=""))
        pool2 = IdeaPool(temp_dir)
        assert pool2.get("idea_010") is not None
        assert pool2.get("idea_010").content == "persist test"
