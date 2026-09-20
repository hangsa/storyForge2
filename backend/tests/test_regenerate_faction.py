"""Tests for POST /api/stage2/regenerate-faction?faction_index=N.

2026-09-20: WorldStep 二级 tab 势力分布 per-subtab ↻ 后端通路。
Mirror /regenerate-power-system-item 语义: faction_index 越界返回 422,
只替换目标条目,其他 byte-preserve。Prompt 拼接单条重生引导语并
透传 faction_only_index。
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app

client = TestClient(app)
PROJ = "proj_test_regenerate_faction"


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
    _write(tmp_path, "concept_and_dna.json", {
        "concept": {"title": "觉醒", "premise": "逆袭", "tone": "热血", "theme": "命运"},
        "story_dna": {"core_contradiction": {"statement": "宿命 vs 自我"}},
    })


def _seed_three_faction_world():
    """Three deliberately distinct factions — non-target ones must remain
    byte-identical (not coerced/reordered by the handler)."""
    return {
        "era": "修真纪元",
        "geography": "九州",
        "era_social_structure": "宗门林立",
        "era_cultural_history": "万年大战",
        "power_systems": [{
            "name": "灵力",
            "description": "吸纳天地灵气",
            "stages": ["炼气", "筑基"],
            "core_rules": ["灵根为根"],
            "ceilings": ["最高元婴"],
            "cost_system": "寿元",
            "source": "energetics",
        }],
        "factions": [
            {"name": "青云宗", "type": "宗门", "goal": "守护苍生", "relations": "中立"},
            {"name": "魔门", "type": "魔宗", "goal": "称霸天下", "relations": "敌对"},
            {"name": "皇朝", "type": "王朝", "goal": "统御四方", "relations": "中立"},
        ],
        "core_rules": [{"category": "physical", "text": "弱肉强食"}],
    }


def _mock_new_factions():
    """The LLM is told to return ONLY one new faction (for slot N)."""
    return [{
        "name": "新势力",
        "type": "隐世门派",
        "goal": "避世潜修",
        "relations": "神秘",
    }]


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    """Default mock: agent returns a single new faction."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            {"factions": _mock_new_factions()},
            None,
        ))
        yield MockPlanner


def test_faction_index_only_writes_target_index(mock_planner, tmp_path):
    """faction_index=1 时,factions[1] 改变,factions[0] / factions[2] byte-identical。
    其他 top-level world.json 字段也 byte-preserve。
    """
    _seed_project(tmp_path)
    seeded = _seed_three_faction_world()
    _write(tmp_path, "world.json", seeded)

    resp = client.post(
        f"/api/stage2/regenerate-faction?project_id={PROJ}",
        json={"faction_index": 1, "user_modifications": ""},
    )
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    factions = detail["factions"]

    # Length unchanged
    assert len(factions) == 3
    # Target index replaced with new faction
    assert factions[1] == _mock_new_factions()[0]
    # Non-target indices byte-identical to seeded
    assert factions[0] == seeded["factions"][0]
    assert factions[2] == seeded["factions"][2]

    # Other top-level keys preserved
    assert detail["era"] == seeded["era"]
    assert detail["geography"] == seeded["geography"]
    assert detail["era_social_structure"] == seeded["era_social_structure"]
    assert detail["era_cultural_history"] == seeded["era_cultural_history"]
    assert detail["power_systems"] == seeded["power_systems"]
    assert detail["core_rules"] == seeded["core_rules"]

    # On-disk file also matches
    on_disk = json.loads((tmp_path / PROJ / "world.json").read_text(encoding="utf-8"))
    assert on_disk["factions"][0] == seeded["factions"][0]
    assert on_disk["factions"][1] == _mock_new_factions()[0]
    assert on_disk["factions"][2] == seeded["factions"][2]


def test_faction_index_out_of_range_raises_422(mock_planner, tmp_path):
    """faction_index >= len(factions) → 422 with FACTION_INDEX_OUT_OF_RANGE。"""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_three_faction_world())

    resp = client.post(
        f"/api/stage2/regenerate-faction?project_id={PROJ}",
        json={"faction_index": 5, "user_modifications": ""},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "FACTION_INDEX_OUT_OF_RANGE"
    # 中文错误信息中应包含 "越界" 标记
    assert "越界" in detail["message"]
    assert detail["detail"]["faction_index"] == 5


def test_faction_only_index_kwarg_passed_to_agent(mock_planner, tmp_path):
    """验证 generate_world 收到 faction_only_index="仅修改第 N 条" 且 user_modifications
    含「单条重生」引导语。N=1 时 faction_only_index 应为 "仅修改第 1 条"。
    """
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_three_faction_world())

    resp = client.post(
        f"/api/stage2/regenerate-faction?project_id={PROJ}",
        json={"faction_index": 1, "user_modifications": "我希望更神秘"},
    )
    assert resp.status_code == 200, resp.text

    # The handler imported PlannerAgent via `from backend.agents.planner
    # import PlannerAgent` (module re-import resolves to the same mock).
    kwargs = mock_planner.return_value.generate_world.call_args.kwargs
    assert kwargs["faction_only_index"] == "仅修改第 1 条"
    # user_modifications 应包含原始文本 + 「单条重生」引导语
    assert "我希望更神秘" in kwargs["user_modifications"]
    assert "【单条重生】" in kwargs["user_modifications"]
    assert "factions[1]" in kwargs["user_modifications"]


def test_negative_faction_index_rejected_by_pydantic(tmp_path, mock_planner):
    """faction_index=-1 被 Pydantic Field(ge=0) 拒绝,FastAPI 转 422 (请求未到 handler)。

    不依赖 mock — 即使没 mock, Pydantic 在 model_validate 阶段就拒了。
    """
    # 不 seed project — 校验应早于 file_manager 调用,无关 project 存在与否。
    resp = client.post(
        f"/api/stage2/regenerate-faction?project_id={PROJ}",
        json={"faction_index": -1, "user_modifications": ""},
    )
    # FastAPI 把 Pydantic ValidationError 渲染成 422 with detail array
    assert resp.status_code == 422
    body = resp.json()
    # FastAPI default 422 detail shape: list[dict] with "loc", "msg", etc.
    assert "detail" in body


def test_payload_direct_construction_rejects_negative():
    """Pydantic model 直接构造也拒绝负值 — 防止有人绕过 FastAPI 边界。"""
    from backend.api.stage2_world_char import RegenerateFactionPayload
    with pytest.raises(ValidationError):
        RegenerateFactionPayload(faction_index=-1, user_modifications="")


def test_missing_project_returns_404(tmp_path, mock_planner):
    """project.json 不存在 → 404 PROJECT_NOT_FOUND。"""
    # 不 seed project
    resp = client.post(
        f"/api/stage2/regenerate-faction?project_id={PROJ}",
        json={"faction_index": 0, "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_agent_value_error_returns_503(tmp_path):
    """agent.generate_world 抛 ValueError → 503 LLM_GENERATION_FAILED。"""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_three_faction_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-faction?project_id={PROJ}",
            json={"faction_index": 0, "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"


def test_agent_returns_empty_factions_returns_503(tmp_path):
    """LLM 返回 factions=[] → 503 LLM_GENERATION_FAILED。"""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_three_faction_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=({"factions": []}, None))
        resp = client.post(
            f"/api/stage2/regenerate-faction?project_id={PROJ}",
            json={"faction_index": 0, "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
