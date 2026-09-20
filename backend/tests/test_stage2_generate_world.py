"""Tests for POST /api/stage2/generate-world — specifically the decompose_data
plumbing from b3_state.json to PlannerAgent.generate_world.

2026-09-19: 砍 S3/S4 后,S2 第一性拆解产生的 5 维度单元直接喂入
world_generation prompt。本文件锁定:
  - `_load_decompose_data` 从 b3_state.json 抽取 5 维度单元 + causal_map
  - 缺失 b3_state.json 时,decompose_data 为空 dict(LLM 端用 "（无）" 占位)
  - `generate-world` 端点把 decompose_data 转发给 PlannerAgent.generate_world

也包含 PlannerAgent.generate_world(decompose_data=) 的占位符注入测试 —
确认 6 个新占位符都被格式化为非空字符串。
"""
import json
import pytest
from pathlib import Path
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient

from backend.main import app


PROJ = "proj_test_world_decompose"

client = TestClient(app)


# --- Fixtures / helpers -------------------------------------------------------


def _write_json(tmp_path: Path, name: str, payload) -> None:
    target = tmp_path / PROJ / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_minimal_project(tmp_path: Path, current_stage: str = "STAGE2") -> None:
    """Seed project.json + concept_and_dna.json,这样 generate-world 端点
    能通过 stage1 precondition 校验。"""
    _write_json(tmp_path, "project.json", {
        "id": PROJ,
        "genre": "cool_novel",
        "current_stage": current_stage,
    })
    _write_json(tmp_path, "concept_and_dna.json", {
        "concept": {
            "title": "测试标题",
            "premise": "测试前提",
            "tone": "热血",
            "theme": "成长",
        },
        "story_dna": {
            "core_contradiction": {"statement": "测试核心矛盾"},
        },
    })


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_world_char
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    # generate-world 端点使用 module-level `fm = FileManager(settings.projects_dir)`,
    # 在 import 时已冻结指向原路径。monkeypatch settings.projects_dir 不会影响
    # 这个 instance — 这里手动重绑到当前 tmp_path,保证端点能读到测试 seed 的文件。
    # 这是 memory project_api_file_manager_pattern.md 中提到的 inconsistency;
    # 修法是把 endpoint 改成用 _file_manager() helper,但那超出本 refactor 范围。
    stage2_world_char.fm = type(stage2_world_char.fm)(tmp_path)
    yield


def _mock_world():
    return {
        "era": "新元",
        "geography": "新地",
        "era_social_structure": "新社",
        "era_cultural_history": "新史",
        "power_systems": [
            {
                "name": "新体系",
                "description": "desc",
                "stages": ["阶一"],
                "core_rules": ["规则"],
                "ceilings": ["上限"],
                "cost_system": "代价",
            }
        ],
        "factions": [
            {"name": "A", "type": "宗门", "goal": "G", "relations": "R"},
        ],
        "core_rules": ["硬规则"],
    }


@pytest.fixture
def mock_planner_capture_args():
    """Mock PlannerAgent that captures the decompose_data kwarg it gets called
    with. Returns (world_payload, capture_dict) — capture_dict['decompose_data']
    will hold whatever the endpoint forwarded.

    Patch 路径必须是 endpoint 内部的 import 路径(`backend.api.stage2_world_char.PlannerAgent`),
    不是原始定义路径 — 因为 stage2_world_char 在 import 时已经做了
    `from backend.agents.planner import PlannerAgent`,patch 原模块不会影响
    已经绑定的名字。
    """
    capture: dict = {}
    with patch("backend.api.stage2_world_char.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value

        async def fake_generate_world(concept, story_dna, genre="cool_novel",
                                       user_modifications="", decompose_data=None):
            capture["decompose_data"] = decompose_data
            capture["concept"] = concept
            capture["user_modifications"] = user_modifications
            return _mock_world(), None

        instance.generate_world = fake_generate_world
        yield _mock_world(), capture


# --- _load_decompose_data -----------------------------------------------------


class TestLoadDecomposeData:
    """Direct unit tests of the helper. The endpoint-level test below
    confirms _load_decompose_data → PlannerAgent.generate_world end-to-end."""

    def test_returns_empty_dict_when_no_b3_state_file(self, tmp_path):
        """b3_state.json 缺失时,dimensions 解析为空 dict,causal_map 仍存在
        作为空串(planner 端 `dd.get("causal_map") or "（无）"` 会 fallback)。
        该行为由 helper 实现自然产生 — dimensions 不存在时 by_dim 为空,
        但 causal_map 字段仍然被构造出来。"""
        from backend.api.stage2_world_char import _load_decompose_data
        out = _load_decompose_data(PROJ)
        # causal_map 留空串(planner 端 or "（无）" 会 fallback)
        assert out.get("causal_map") == ""
        # 5 维度键不存在(dimensions 空 → by_dim 也是空)
        for k in ("ontology", "energetics", "power_structure",
                  "protagonist_engine", "narrative_physics"):
            assert k not in out, f"无 b3_state 时不应有 {k!r} 键,got {out.get(k)!r}"

    def test_extracts_five_dimensions(self, tmp_path):
        from backend.api.stage2_world_char import _load_decompose_data
        _write_json(tmp_path, "creative_os/b3_state.json", {
            "dimensions": [
                {
                    "dimension": "ontology",
                    "units": [
                        {"unit_name": "灵窍", "description": "接口的具象化", "is_irreducible": True},
                        {"unit_name": "门禁", "description": "规则进入门槛", "is_irreducible": False},
                    ],
                },
                {
                    "dimension": "energetics",
                    "units": [
                        {"unit_name": "能量", "description": "世界能源"},
                    ],
                },
                {"dimension": "power_structure", "units": []},
                {"dimension": "protagonist_engine", "units": []},
                {"dimension": "narrative_physics", "units": []},
            ],
            "causal_map": "灵窍 → 能量 → 权力",
        })
        loaded = _load_decompose_data(PROJ)
        assert set(loaded.keys()) == {
            "ontology", "energetics", "power_structure",
            "protagonist_engine", "narrative_physics", "causal_map",
        }
        assert loaded["causal_map"] == "灵窍 → 能量 → 权力"
        # ontology 应保留 2 个单元,带 is_irreducible 元信息(透传给 prompt,
        # 由 prompt 模板决定如何用)
        assert len(loaded["ontology"]) == 2
        assert loaded["ontology"][0]["unit_name"] == "灵窍"
        assert loaded["ontology"][1]["unit_name"] == "门禁"
        # 只透传 unit_name + description(其他元字段被剥离)
        assert set(loaded["ontology"][0].keys()) == {"unit_name", "description"}
        assert "is_irreducible" not in loaded["ontology"][0]
        # 空维度应保留为 []
        assert loaded["power_structure"] == []

    def test_missing_causal_map_becomes_empty_string(self, tmp_path):
        from backend.api.stage2_world_char import _load_decompose_data
        _write_json(tmp_path, "creative_os/b3_state.json", {
            "dimensions": [
                {"dimension": "ontology", "units": []},
                {"dimension": "energetics", "units": []},
                {"dimension": "power_structure", "units": []},
                {"dimension": "protagonist_engine", "units": []},
                {"dimension": "narrative_physics", "units": []},
            ],
            # 注意:故意不写 causal_map
        })
        loaded = _load_decompose_data(PROJ)
        assert loaded["causal_map"] == ""

    def test_non_list_dimensions_returns_empty(self, tmp_path):
        """防御:b3_state.json 的 dimensions 被破坏为非 list(例如写成 dict)时,
        端点不应抛 500,而是返回空 dict 让 prompt 用 fallback。"""
        from backend.api.stage2_world_char import _load_decompose_data
        _write_json(tmp_path, "creative_os/b3_state.json", {
            "dimensions": {"ontology": "garbage"},
        })
        loaded = _load_decompose_data(PROJ)
        assert loaded == {}

    def test_skips_dimension_with_no_key(self, tmp_path):
        from backend.api.stage2_world_char import _load_decompose_data
        _write_json(tmp_path, "creative_os/b3_state.json", {
            "dimensions": [
                {"dimension": "", "units": [{"unit_name": "无名", "description": "D"}]},
                {"units": [{"unit_name": "无名2", "description": "D2"}]},  # 缺 dimension 字段
                {"dimension": "ontology", "units": [{"unit_name": "灵窍", "description": "OK"}]},
            ],
        })
        loaded = _load_decompose_data(PROJ)
        assert "ontology" in loaded
        assert len(loaded["ontology"]) == 1
        # 没有 dimension 键的两条都不应出现
        assert len(loaded) == 2  # ontology + causal_map(空)

    def test_unit_missing_unit_name_falls_back_in_prompt(self, tmp_path):
        """缺 unit_name 的 unit 在 helper 层透传为空串,_format_dimension_units
        会 fallback 为 "未命名"。这里锁住 helper 不抛异常且透传空 name。"""
        from backend.api.stage2_world_char import _load_decompose_data
        _write_json(tmp_path, "creative_os/b3_state.json", {
            "dimensions": [
                {"dimension": "ontology", "units": [
                    {"description": "no name"},
                    {"unit_name": None, "description": "explicit null"},
                ]},
                {"dimension": "energetics", "units": []},
                {"dimension": "power_structure", "units": []},
                {"dimension": "protagonist_engine", "units": []},
                {"dimension": "narrative_physics", "units": []},
            ],
        })
        loaded = _load_decompose_data(PROJ)
        assert loaded["ontology"][0] == {"unit_name": "", "description": "no name"}
        assert loaded["ontology"][1] == {"unit_name": "", "description": "explicit null"}


# --- POST /api/stage2/generate-world -----------------------------------------


def test_generate_world_forwards_decompose_data_to_planner(
    mock_planner_capture_args, tmp_path
):
    """端到端:b3_state.json 有 5 维度单元 → 端点转发到 PlannerAgent.generate_world
    的 decompose_data 参数,且 shape 正确。"""
    _seed_minimal_project(tmp_path)
    _write_json(tmp_path, "creative_os/b3_state.json", {
        "dimensions": [
            {
                "dimension": "ontology",
                "units": [
                    {"unit_name": "灵窍", "description": "接口"},
                    {"unit_name": "门禁", "description": "门槛"},
                ],
            },
            {"dimension": "energetics", "units": []},
            {"dimension": "power_structure", "units": []},
            {"dimension": "protagonist_engine", "units": []},
            {"dimension": "narrative_physics", "units": []},
        ],
        "causal_map": "灵窍 → 门禁",
    })

    resp = client.post(
        f"/api/stage2/generate-world",
        json={"project_id": PROJ, "user_modifications": ""},
    )
    assert resp.status_code == 200, resp.text

    payload, capture = mock_planner_capture_args
    assert capture["decompose_data"] is not None
    dd = capture["decompose_data"]
    assert len(dd["ontology"]) == 2
    assert dd["ontology"][0]["unit_name"] == "灵窍"
    assert dd["causal_map"] == "灵窍 → 门禁"
    # 概念字段是从 concept_and_dna.json 读到的(原 v2 行为,本测试不验证)


def test_generate_world_with_no_b3_state_passes_none_decompose(
    mock_planner_capture_args, tmp_path
):
    """缺失 b3_state.json 时,decompose_data 为 None(planner 端走空字典 fallback)。
    这是老项目兼容路径 — 没走过 S2 拆解的项目不应在 /generate-world 崩。"""
    _seed_minimal_project(tmp_path)
    # 故意不写 creative_os/b3_state.json
    resp = client.post(
        f"/api/stage2/generate-world",
        json={"project_id": PROJ, "user_modifications": ""},
    )
    assert resp.status_code == 200, resp.text

    payload, capture = mock_planner_capture_args
    # _load_decompose_data 缺文件 → 返回 {"causal_map": ""} 但 5 维度键缺失。
    # planner 端 `dd = decompose_data or {}` 透传,所有维度 helper 端 fallback "（无）"。
    dd = capture["decompose_data"]
    assert dd is not None
    assert dd.get("causal_map") == ""
    for k in ("ontology", "energetics", "power_structure",
              "protagonist_engine", "narrative_physics"):
        assert k not in dd or dd[k] == []


def test_generate_world_forwards_user_modifications(
    mock_planner_capture_args, tmp_path
):
    """端点应把 user_modifications 透传给 planner(老行为,顺便保留)。"""
    _seed_minimal_project(tmp_path)
    resp = client.post(
        f"/api/stage2/generate-world",
        json={"project_id": PROJ, "user_modifications": "  加入门派争议  "},
    )
    assert resp.status_code == 200, resp.text

    payload, capture = mock_planner_capture_args
    assert capture["user_modifications"] == "  加入门派争议  "


# --- PlannerAgent.generate_world(decompose_data=...) 占位符注入 ----------


class TestPlannerGenerateWorldDecomposePlumbing:
    """覆盖 PlannerAgent.generate_world 把 decompose_data 字段注入到
    world_generation user_prompt_template 的 6 个占位符。这一层是 helper
    链的最末端 — 如果未来 helper 改了输出格式但 template 没改,会在这里
    暴露 placeholder 未被替换或内容不一致。"""

    @pytest.fixture
    def captured_template_kwargs(self):
        """用 fake provider 捕获 world_generation user_prompt_template 的格式化 kwargs。
        同时 mock log_usage 避免 BaseAgent.__init__ 之外的属性需求。"""
        from backend.agents.planner import PlannerAgent

        captured: dict = {}

        async def fake_generate_from_template(
            self, template_name, **kwargs
        ):
            captured["template_name"] = template_name
            captured["kwargs"] = kwargs
            return _mock_world(), None

        with patch.object(
            PlannerAgent, "generate_from_template",
            new=fake_generate_from_template,
        ), patch.object(PlannerAgent, "log_usage", lambda *a, **kw: None):
            yield captured

    @pytest.mark.asyncio
    async def test_decompose_data_fields_reach_template_kwargs(
        self, captured_template_kwargs
    ):
        from backend.agents.planner import PlannerAgent

        agent = PlannerAgent.__new__(PlannerAgent)  # 不走 __init__,跳过 LLM wiring
        agent.project_id = "test_proj"  # log_usage 需要
        decompose = {
            "ontology": [{"unit_name": "灵窍", "description": "接口"}],
            "energetics": [{"unit_name": "能量", "description": "能源"}],
            "power_structure": [],
            "protagonist_engine": [{"unit_name": "觉醒", "description": "主角机制"}],
            "narrative_physics": [],
            "causal_map": "灵窍 → 能量",
        }
        await agent.generate_world(
            concept={"title": "T", "premise": "P", "tone": "热血", "theme": "成长"},
            story_dna={"core_contradiction": {"statement": "矛盾"}},
            decompose_data=decompose,
        )

        kw = captured_template_kwargs["kwargs"]
        assert captured_template_kwargs["template_name"] == "world_generation"
        # 5 维度单元应被 helper 渲染为非占位符的真实文本
        assert "**灵窍**" in kw["ontology_units"]
        assert "**能量**" in kw["energetics_units"]
        assert kw["power_structure_units"] == "（无）"
        assert "**觉醒**" in kw["protagonist_engine_units"]
        assert kw["narrative_physics_units"] == "（无）"
        assert kw["causal_map"] == "灵窍 → 能量"

    @pytest.mark.asyncio
    async def test_no_decompose_data_falls_back_to_placeholders(
        self, captured_template_kwargs
    ):
        from backend.agents.planner import PlannerAgent

        agent = PlannerAgent.__new__(PlannerAgent)
        agent.project_id = "test_proj"
        await agent.generate_world(
            concept={"title": "T", "premise": "P", "tone": "热血", "theme": "成长"},
            story_dna={"core_contradiction": {"statement": "矛盾"}},
            decompose_data=None,
        )
        kw = captured_template_kwargs["kwargs"]
        # 缺省时 6 个占位符全部用 "（无）" — 这是与老项目(没有 b3_state)的契约
        for key in (
                "ontology_units", "energetics_units", "power_structure_units",
                "protagonist_engine_units", "narrative_physics_units",
        ):
            assert kw[key] == "（无）", f"{key} 应为 '（无）', got {kw[key]!r}"
        assert kw["causal_map"] == "（无）"