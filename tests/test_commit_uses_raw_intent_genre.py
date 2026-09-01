"""Verify /commit reads genre from raw_intent and writes fusion_meta.

Task 5 of the 类型融合 (genre fusion) wiring plan: backend /commit handler
must source `concept.genre` from `raw_intent.genre_primary` (with project.json
fallback) and persist `story_dna.fusion_meta` when a fusion variant exists AND
`raw_intent.genre_secondary` is set.

Two scenarios:
  1. raw_intent.genre_secondary present + fusion variant on canvas
        => story_dna.fusion_meta is written with {secondary_genre, risk_level,
           distance}; concept.genre matches raw_intent.genre_primary
  2. raw_intent.genre_secondary absent
        => story_dna.fusion_meta is NOT written
"""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_intent(tmp_path):
    """Canvas with raw_intent.genre_primary + fusion variant in idea_variants."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_commit_intent"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    # Build a multi-node canvas so /commit path validation passes
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "root", "novelty_score": 70,
                    "trope_tags": [], "saturation_warning": False,
                    "mutation_context": None, "children_ids": ["wi_002_00"],
                    "is_expanded": True, "branch_status": "active",
                },
                "wi_002_00": {
                    "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                    "content": "child", "novelty_score": 80,
                    "trope_tags": [], "saturation_warning": False,
                    "mutation_context": None, "children_ids": [],
                    "is_expanded": True, "branch_status": "active",
                },
            },
            "edges": [], "selected_path": ["wi_001_00", "wi_002_00"],
            "branch_choices": {"wi_001_00": "wi_002_00"}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [
                {"id": "f1", "mutation_type": "fusion",
                 "risk_level": "medium", "fusion_distance": 2,
                 "title": "test fusion", "premise_one_line": "",
                 "mutation_logic": "", "estimated_novelty": 0.7,
                 "trope_tags": ["xianxia", "xuanyi"], "regenerated_count": 0},
            ],
            "core_contradiction": {
                "template_type": "ABILITY_VS_LIMIT",
                "statement": "长生者无法真正死去,因而在永恒中失去意义",
                "side_a": "长生", "side_b": "寻死",
                "tension_score": 85, "is_custom": False,
                "confirmed_at": "2026-08-30T10:00:00",
            },
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "长生者寻死",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def stub_llm(monkeypatch):
    """Stub PlannerAgent.generate_concept_from_canvas to skip LLM."""
    async def fake_generate_concept_from_canvas(self, canvas_summary, genre="cool_novel"):
        return (
            {
                "concept": {
                    "title": "长生者的悬疑", "premise": "summary",
                    "theme": "永恒 vs 短暂", "tone": "深沉",
                    "genre": genre,
                },
                "story_dna": {
                    "core_contradiction": {"statement": "长生者寻死的悖论"},
                    "style_template": "xianxia_noir",
                    "value_stack": [
                        {"level": "personal", "name": "p"},
                        {"level": "social", "name": "s"},
                        {"level": "philosophical", "name": "ph"},
                        {"level": "existential", "name": "e"},
                    ],
                },
            },
            None,
        )
    from backend.agents.planner import PlannerAgent
    monkeypatch.setattr(
        PlannerAgent, "generate_concept_from_canvas",
        fake_generate_concept_from_canvas,
    )


def test_commit_writes_fusion_meta_when_genre_secondary_exists(project_with_intent, client):
    response = client.post(
        f"/api/v1/projects/{project_with_intent}/creative/diverge/commit", json={}
    )
    assert response.status_code == 200, response.text

    concept_path = settings.projects_dir / project_with_intent / "concept_and_dna.json"
    concept_and_dna = json.loads(concept_path.read_text(encoding="utf-8"))

    assert concept_and_dna["concept"]["genre"] == "xianxia"
    fusion_meta = concept_and_dna["story_dna"].get("fusion_meta")
    assert fusion_meta is not None
    assert fusion_meta["secondary_genre"] == "xuanyi"
    assert fusion_meta["risk_level"] == "medium"
    assert fusion_meta["distance"] == 2


def test_commit_uses_genre_primary_when_no_secondary(tmp_path):
    """When raw_intent.genre_secondary is absent, fusion_meta must NOT be written."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_secondary"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {"id": "wi_001_00", "depth": 0, "parent_id": None, "content": "r",
                              "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                              "mutation_context": None, "children_ids": ["wi_002_00"],
                              "is_expanded": True, "branch_status": "active"},
                "wi_002_00": {"id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                              "content": "c", "novelty_score": 0, "trope_tags": [],
                              "saturation_warning": False, "mutation_context": None,
                              "children_ids": [], "is_expanded": True, "branch_status": "active"},
            },
            "edges": [], "selected_path": ["wi_001_00", "wi_002_00"],
            "branch_choices": {"wi_001_00": "wi_002_00"}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {"prompt": "p", "genre_primary": "xianxia", "trope_tags": []},
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(diverge_router)
    c = TestClient(app)
    response = c.post(f"/api/v1/projects/{pid}/creative/diverge/commit", json={})
    assert response.status_code == 200
    # Reload canvas from actual disk (settings reset)
    settings.projects_dir = tmp_path
    concept_path = settings.projects_dir / pid / "concept_and_dna.json"
    concept_and_dna = json.loads(concept_path.read_text(encoding="utf-8"))
    assert concept_and_dna["concept"]["genre"] == "xianxia"
    assert "fusion_meta" not in concept_and_dna["story_dna"]
    settings.projects_dir = original
