"""Tests for POST /api/stage2/regenerate-world-section.

Sections: era (era + geography + era_social_structure + era_cultural_history),
power_systems (array), factions (array), core_rules (top-level array).
Other top-level keys stay byte-identical.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_world_section"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_project(tmp_path: Path) -> None:
    _write(tmp_path, "project.json", {
        "id": PROJ,
        "genre": "cool_novel",
        "initial_intent": {"free_text": "少年觉醒"},
    })


def _seed_old_world():
    return {
        "era": "旧时代",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_system": {
            "name": "旧体系",
            "description": "旧描述",
            "stages": ["旧一阶"],
            "core_rules": ["旧规则"],
            "ceilings": ["旧上限"],
            "cost_system": "旧代价",
            "source": "energetics",
        },
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


def _mock_world_payload():
    return {
        "era": "新时代",
        "geography": "新地理",
        "era_social_structure": "新社会",
        "era_cultural_history": "新历史",
        "power_systems": [
            {
                "name": "新体系",
                "description": "新描述",
                "stages": ["新一阶", "新二阶"],
                "core_rules": ["新规则"],
                "ceilings": ["新上限"],
                "cost_system": "新代价",
            },
            {
                "name": "新体系B",
                "description": "新描述B",
                "stages": ["乙一阶"],
                "core_rules": ["乙规则"],
                "ceilings": ["乙上限"],
                "cost_system": None,
            },
        ],
        "factions": [
            {"name": "新势力A", "type": "宗门", "goal": "新目标A", "relations": "新关系A"},
        ],
        "core_rules": ["世界规则新"],
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_world_payload(),
            None,
        ))
        yield MockPlanner


def test_regenerate_era_rewrites_only_era_block(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "era", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["era"] == "新时代"
    assert detail["geography"] == "新地理"
    assert detail["era_social_structure"] == "新社会"
    assert detail["era_cultural_history"] == "新历史"
    # power systems / factions / core_rules preserved (legacy key migrated)
    assert "power_system" not in detail
    assert detail["power_systems"] == [_seed_old_world()["power_system"]]
    assert detail["factions"] == _seed_old_world()["factions"]
    # v2.x: legacy list[str] core_rules migrated to list[{category, text}]
    assert detail["core_rules"] == [
        {"category": "physical", "text": r}
        for r in _seed_old_world()["core_rules"]
    ]


def test_regenerate_power_system_rewrites_only_power_system(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "power_system", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert [ps["name"] for ps in detail["power_systems"]] == ["新体系", "新体系B"]
    assert detail["power_systems"][0]["stages"] == ["新一阶", "新二阶"]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["factions"] == _seed_old_world()["factions"]
    # v2.x: legacy list[str] core_rules migrated to list[{category, text}]
    assert detail["core_rules"] == [
        {"category": "physical", "text": r}
        for r in _seed_old_world()["core_rules"]
    ]


def test_regenerating_another_section_migrates_a_legacy_world_on_disk(
    mock_planner, tmp_path
):
    """A legacy world.json carries the singular `power_system`. Regenerating
    an unrelated section must fold it into `power_systems` on write rather
    than leaving both keys in the file."""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "factions", "user_modifications": ""},
    )
    assert resp.status_code == 200

    on_disk = json.loads((tmp_path / PROJ / "world.json").read_text(encoding="utf-8"))
    assert "power_system" not in on_disk
    assert on_disk["power_systems"] == [_seed_old_world()["power_system"]]


def test_regenerate_core_rules_rewrites_only_top_level_array(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "core_rules", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["core_rules"] == [{"category": "physical", "text": "世界规则新"}]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_systems"] == [_seed_old_world()["power_system"]]
    assert detail["factions"] == _seed_old_world()["factions"]


def test_regenerate_factions_rewrites_only_factions_array(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "factions", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["factions"]) == 1
    assert detail["factions"][0]["name"] == "新势力A"
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_systems"] == [_seed_old_world()["power_system"]]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "history", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"


def test_regenerate_missing_project_returns_404(tmp_path):
    # No project.json — 404 fires before planner access.
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "era", "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


# ---------------------------------------------------------------------------
# Category-filtered core_rules regeneration (Task 5 / 修订 E).
#
# When the user picks a category (e.g. only the "physical" rules), only
# entries with that category get replaced; other categories stay byte-
# preserved. When `category` is omitted, the legacy full-array replace is
# used (back-compat for older callers).
# ---------------------------------------------------------------------------


def _seed_old_world_with_all_categories():
    return {
        "era": "旧时代",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_systems": [
            {
                "name": "旧体系",
                "description": "旧描述",
                "stages": ["旧一阶"],
                "core_rules": ["旧规则"],
                "ceilings": ["旧上限"],
                "cost_system": "旧代价",
            }
        ],
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": [
            {"category": "physical", "text": "旧 physical 规则"},
            {"category": "social", "text": "旧 social 规则(应保留)"},
            {"category": "narrative", "text": "旧 narrative 规则(应保留)"},
            {"category": "protagonist", "text": "旧 protagonist 规则(应保留)"},
        ],
    }


def _mock_physical_only_payload():
    """LLM mocked to return ONLY physical rules — even though the schema
    would allow it to return other categories, we want to verify the
    endpoint filters on the LLM output as well."""
    return {
        "era": "新时代",
        "geography": "新地理",
        "era_social_structure": "新社会",
        "era_cultural_history": "新历史",
        "power_systems": [
            {
                "name": "新体系",
                "description": "新描述",
                "stages": ["新一阶"],
                "core_rules": ["新规则"],
                "ceilings": ["新上限"],
                "cost_system": "新代价",
            }
        ],
        "factions": [
            {"name": "新势力A", "type": "宗门", "goal": "新目标A", "relations": "新关系A"},
        ],
        "core_rules": [
            {"category": "physical", "text": "新 physical 规则 A"},
            {"category": "physical", "text": "新 physical 规则 B"},
        ],
    }


def test_regenerate_core_rules_by_category_preserves_other_categories(
    tmp_path,
):
    """When section='core_rules' and category='physical', only physical
    rules are replaced; social/narrative/protagonist rules in the existing
    world.json are byte-preserved."""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world_with_all_categories())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_physical_only_payload(),
            None,
        ))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "core_rules", "category": "physical"},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    merged_rules = detail["core_rules"]
    # Old social/narrative/protagonist entries still present
    kept = {r["text"] for r in merged_rules if r["text"].startswith("旧 ")}
    assert kept == {
        "旧 social 规则(应保留)",
        "旧 narrative 规则(应保留)",
        "旧 protagonist 规则(应保留)",
    }
    # New physical replaced old physical
    assert any(r["text"] == "新 physical 规则 A" for r in merged_rules)
    assert any(r["text"] == "新 physical 规则 B" for r in merged_rules)
    assert not any(r["text"] == "旧 physical 规则" for r in merged_rules)
    # Final shape — exactly 5 rules: 3 preserved + 2 new
    assert len(merged_rules) == 5
    # Other top-level keys untouched
    assert detail["era"] == "旧时代"
    assert detail["factions"] == _seed_old_world_with_all_categories()["factions"]


def test_regenerate_core_rules_without_category_replaces_all(tmp_path):
    """Backward compat — section='core_rules' with no category field
    keeps the old behavior (replace entire core_rules array)."""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world_with_all_categories())
    # LLM returns all four categories
    mixed_payload = {
        "era": "新时代",
        "geography": "新地理",
        "era_social_structure": "新社会",
        "era_cultural_history": "新历史",
        "power_systems": [
            {
                "name": "新体系",
                "description": "新描述",
                "stages": ["新一阶"],
                "core_rules": ["新规则"],
                "ceilings": ["新上限"],
                "cost_system": "新代价",
            }
        ],
        "factions": [
            {"name": "新势力A", "type": "宗门", "goal": "新目标A", "relations": "新关系A"},
        ],
        "core_rules": [
            {"category": "physical", "text": "新 physical"},
            {"category": "social", "text": "新 social"},
        ],
    }
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(mixed_payload, None))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "core_rules"},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    # Legacy full-array path: 旧 rules all gone, only new ones remain
    assert detail["core_rules"] == mixed_payload["core_rules"]
    assert not any(r["text"].startswith("旧 ") for r in detail["core_rules"])


def test_regenerate_core_rules_with_invalid_category_rejected(tmp_path):
    """An unknown category string must be rejected at the pydantic boundary
    (typo would otherwise silently return core_rules:[] via the category filter)."""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world_with_all_categories())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "core_rules", "category": "physcial"},
    )
    assert resp.status_code == 422


def test_regenerate_core_rules_by_category_migrates_legacy_string_list(tmp_path):
    """A legacy core_rules: ['str1', 'str2', 'str3'] world.json must migrate
    to list[{category:physical,text:str}] before the category filter runs, so
    legacy rules are not silently dropped on first category-scoped call.

    We use category='social' so the migrated PHYSICAL legacy rules survive
    the filter (which keeps non-target categories). With category='physical'
    the legacy rules would intentionally be replaced — that's the normal
    regeneration semantic, not a bug.
    """
    _seed_project(tmp_path)
    legacy_world = {
        "era": "旧时代",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_systems": [
            {
                "name": "旧体系",
                "description": "旧描述",
                "stages": ["旧一阶"],
                "core_rules": ["旧规则"],
                "ceilings": ["旧上限"],
                "cost_system": "旧代价",
            }
        ],
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        # legacy flat list[str]
        "core_rules": ["旧规则A", "旧规则B", "旧规则C"],
    }
    _write(tmp_path, "world.json", legacy_world)
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_physical_only_payload(),
            None,
        ))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "core_rules", "category": "social"},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    merged_rules = detail["core_rules"]
    # All 3 legacy strings migrated to category=physical and preserved (target_cat=social)
    texts = {r["text"] for r in merged_rules}
    assert "旧规则A" in texts
    assert "旧规则B" in texts
    assert "旧规则C" in texts
    legacy_entries = [r for r in merged_rules if r["text"] in {"旧规则A", "旧规则B", "旧规则C"}]
    assert {r["category"] for r in legacy_entries} == {"physical"}
    # The LLM mock only returned physical rules — none match target_cat=social,
    # so no new rules get appended. (The new physical rules were correctly
    # rejected by the LLM-side filter to avoid polluting the social category.)
    assert not any(r["text"].startswith("新 physical") for r in merged_rules)
    assert len(merged_rules) == 3
