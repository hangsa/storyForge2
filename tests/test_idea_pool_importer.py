import json
import pytest
from pathlib import Path
from backend.creative_os.idea_pool import IdeaPool
from backend.creative_os.idea_pool_importer import IdeaPoolImporter


@pytest.fixture
def pool(tmp_path):
    """Per-project IdeaPool at tmp_path/proj_pool/creative_os/idea_pool.json."""
    project_dir = tmp_path / "proj_pool"
    (project_dir / "creative_os").mkdir(parents=True)
    return IdeaPool(project_dir)


def test_importer_adds_variants_as_ideas(pool):
    importer = IdeaPoolImporter(pool)
    variants = [
        {
            "id": "v1",
            "title": "Test",
            "premise_one_line": "A premise",
            "mutation_type": "inversion",
            "estimated_novelty": 0.7,
            "trope_tags": ["修仙", "逆袭"],
        },
    ]
    importer.add_batch(variants, source_stage="mutate:inversion")

    ideas = pool.list()
    assert len(ideas) == 1
    assert ideas[0].id == "v1"
    assert ideas[0].content == "A premise"
    assert ideas[0].source_stage == "mutate:inversion"
    assert ideas[0].category == "设定灵感"  # IdeaCategory.SETTING.value
    assert "修仙" in ideas[0].related_elements
    assert "逆袭" in ideas[0].related_elements


def test_importer_persists_to_disk(pool):
    importer = IdeaPoolImporter(pool)
    importer.add_batch(
        [{"id": "v2", "title": "X", "premise_one_line": "y premise"}],
        source_stage="fuse",
    )
    pool_file = pool._file
    data = json.loads(pool_file.read_text())
    assert len(data) == 1
    assert data[0]["id"] == "v2"
    assert data[0]["content"] == "y premise"
    assert data[0]["source_stage"] == "fuse"


def test_importer_handles_missing_premise_with_title_fallback(pool):
    """If premise_one_line is missing, fall back to title."""
    importer = IdeaPoolImporter(pool)
    importer.add_batch(
        [{"id": "v3", "title": "Title Only"}],
        source_stage="mutate:subversion",
    )
    ideas = pool.list()
    assert ideas[0].content == "Title Only"


def test_importer_handles_empty_trope_tags(pool):
    importer = IdeaPoolImporter(pool)
    importer.add_batch(
        [{"id": "v4", "title": "T", "premise_one_line": "P"}],
        source_stage="fuse",
    )
    ideas = pool.list()
    assert ideas[0].related_elements == []


def test_importer_handles_zero_novelty(pool):
    importer = IdeaPoolImporter(pool)
    importer.add_batch(
        [{"id": "v5", "title": "T", "premise_one_line": "P", "estimated_novelty": 0}],
        source_stage="fuse",
    )
    ideas = pool.list()
    assert ideas[0].confidence == 0.0


def test_importer_adds_multiple_in_one_call(pool):
    importer = IdeaPoolImporter(pool)
    variants = [
        {"id": "v6", "title": "T1", "premise_one_line": "P1"},
        {"id": "v7", "title": "T2", "premise_one_line": "P2"},
        {"id": "v8", "title": "T3", "premise_one_line": "P3"},
    ]
    importer.add_batch(variants, source_stage="fuse")
    ideas = pool.list()
    assert len(ideas) == 3
    assert {i.id for i in ideas} == {"v6", "v7", "v8"}


def test_importer_preserves_full_variant_as_source_context(pool):
    """source_context is the full JSON for audit."""
    importer = IdeaPoolImporter(pool)
    v = {
        "id": "v9", "title": "T", "premise_one_line": "P",
        "mutation_type": "inversion", "mutation_logic": "X→非X",
        "estimated_novelty": 0.8, "trope_tags": ["玄幻"],
    }
    importer.add_batch([v], source_stage="mutate:inversion")
    idea = pool.list()[0]
    parsed = json.loads(idea.source_context)
    assert parsed["id"] == "v9"
    assert parsed["mutation_logic"] == "X→非X"
    assert parsed["trope_tags"] == ["玄幻"]