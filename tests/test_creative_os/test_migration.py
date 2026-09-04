"""Verify v3 → v4 canvas_state.json migration."""
import pytest
from backend.creative_os.migration import (
    _migrate_v3_to_v4,
    _build_root_idea_from_raw_intent,
    _build_creative_path_from_v3,
    _build_current_concept_from_v3,
)


V3_MINIMAL = {
    "schema_version": 3,
    "session_id": "sess-1",
    "root_node_id": "wi_001_00",
    "nodes": {
        "wi_001_00": {
            "id": "wi_001_00", "depth": 0, "parent_id": None,
            "content": "长生者寻死的故事", "novelty_score": 70,
            "trope_tags": [], "saturation_warning": False,
            "mutation_context": None, "children_ids": ["wi_002_00"],
            "is_expanded": True, "branch_status": "active",
        },
        "wi_002_00": {
            "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
            "content": "调查未来尸体", "novelty_score": 80,
            "trope_tags": [], "saturation_warning": False,
            "mutation_context": None, "children_ids": [],
            "is_expanded": True, "branch_status": "active",
        },
    },
    "edges": [],
    "selected_path": ["wi_001_00", "wi_002_00"],
    "branch_choices": {"wi_001_00": "wi_002_00"},
    "evaluations": {},
    "created_at": "2026-08-30T10:00:00",
    "updated_at": "2026-08-30T10:00:00",
    "committed_at": None,
    "committed_concept_ref": None,
    "idea_variants": [],
    "core_contradiction": {
        "template_type": "ABILITY_VS_LIMIT",
        "statement": "长生者无法真正死去",
        "side_a": "长生", "side_b": "寻死",
        "tension_score": 85, "is_custom": False,
        "confirmed_at": "2026-08-30T10:00:00",
    },
    "novelty_scores": None,
    "raw_intent": {
        "prompt": "长生者寻死",
        "genre_primary": "仙侠",
        "genre_secondary": "悬疑",
        "trope_tags": [],
    },
    "session_metadata": {
        "created_at": "2026-08-30T10:00:00",
        "last_modified_at": "2026-08-30T10:00:00",
        "elapsed_seconds": 0, "operation_count": 5,
    },
}


def test_migrate_returns_v4_schema_version():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["schema_version"] == 4


def test_migrate_preserves_session_id():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["session_id"] == "sess-1"


def test_migrate_preserves_v3_fields_additively():
    """Migration is additive: v3 fields survive into the v4 view.

    Both divergence (v1 creative_diverge router) and plot canvas (v2
    v2_canvas router) read the same `creative_os/canvas_state.json` file.
    Divergence UI expects v3 fields (`state.root_node_id`,
    `state.nodes`, etc.) for S0BMutationStep; plot canvas UI expects
    v4 fields (`state.creative_path`, etc.). Stripping v3 fields on
    migration broke divergence Step B which throws
    "画布尚未初始化,请先完成 Step A" immediately after /init
    (proj_01214ec3, 2026-09-04).

    The v2_canvas router is permissive about extra fields, so additive
    migration is safe in both directions.
    """
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["root_node_id"] == "wi_001_00"
    assert v4["nodes"] == V3_MINIMAL["nodes"]
    assert v4["selected_path"] == ["wi_001_00", "wi_002_00"]
    assert v4["branch_choices"] == {"wi_001_00": "wi_002_00"}
    assert v4["idea_variants"] == []
    assert v4["core_contradiction"] == V3_MINIMAL["core_contradiction"]
    assert v4["evaluations"] == {}
    assert v4["created_at"] == "2026-08-30T10:00:00"
    assert v4["updated_at"] == "2026-08-30T10:00:00"
    # edges is re-derived from nodes.children_ids (matches disk write-through)
    assert v4["edges"] == [{"from": "wi_001_00", "to": "wi_002_00"}]
    # v4 fields are also present (not mutually exclusive)
    assert v4["schema_version"] == 4
    assert "creative_path" in v4
    assert "root_idea" in v4
    assert "current_concept" in v4


def test_migrate_builds_root_idea_from_raw_intent():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    root = v4["root_idea"]
    assert root["prompt"] == "长生者寻死"
    assert root["genre"] == "仙侠"
    assert root["premise"] == "长生者寻死"
    assert root["extracted"]["core_elements"] == []  # trope_tags was empty


def test_migrate_preserves_raw_intent():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["raw_intent"]["prompt"] == "长生者寻死"
    assert v4["raw_intent"]["genre_primary"] == "仙侠"
    assert v4["raw_intent"]["genre_secondary"] == "悬疑"


def test_migrate_creative_path_has_5_step1_available():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    path = v4["creative_path"]
    assert len(path) == 2  # 仅迁移 selected_path 实际走过的步数
    assert path[0]["step"] == 1
    assert path[0]["state"] == "completed"  # 历史已选过
    assert path[0]["selected_option_id"] == "option_root"
    assert path[1]["step"] == 2
    assert path[1]["state"] == "completed"


def test_migrate_creative_session_current_step_reflects_path_length():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    cs = v4["creative_session"]
    assert cs["current_step"] == 2  # = len(selected_path)
    assert cs["max_steps"] == 5
    assert cs["status"] == "active"  # 未 commit


def test_migrate_committed_sets_status_committed_and_final_concept():
    v3_committed = {**V3_MINIMAL, "committed_at": "2026-09-01T10:00:00"}
    v4 = _migrate_v3_to_v4(v3_committed)
    assert v4["creative_session"]["status"] == "committed"
    assert v4["committed"] is True
    assert v4["committed_at"] == "2026-09-01T10:00:00"
    assert v4["final_concept"] is not None  # core_contradiction 迁到 final_concept


def test_migrate_uncommitted_keeps_final_concept_null_and_current_concept():
    v4 = _migrate_v3_to_v4(V3_MINIMAL)
    assert v4["final_concept"] is None
    cc = v4["current_concept"]
    assert cc["premise"] == ""  # 无 v3 字段 → 空字符串
    assert cc["core_conflict"] == "长生者无法真正死去"  # 从 core_contradiction 派生


def test_migrate_pure_function_does_not_mutate_input():
    import copy
    snapshot = copy.deepcopy(V3_MINIMAL)
    _migrate_v3_to_v4(V3_MINIMAL)
    assert V3_MINIMAL == snapshot


def test_migrate_handles_empty_selected_path():
    v3_empty = {**V3_MINIMAL, "selected_path": [], "nodes": {}}
    v4 = _migrate_v3_to_v4(v3_empty)
    assert v4["creative_path"] == []
    assert v4["creative_session"]["current_step"] == 1
