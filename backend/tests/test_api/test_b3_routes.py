"""Tests for /api/v1/projects/{id}/creative/diverge/b3/* routes.

Covers the 2-stage flow after the 2026-09-19 cut of S3 自适应发散 + S4 LLM 合成:

- GET    /state              — 404 when missing, 200 when present
- DELETE /state              — 404 when missing, 200 + file removed
- POST   /decompose          — 422 on short prompt, happy + ValueError + RuntimeError
- POST   /follow-up          — happy + 422 + 503
- POST   /commit             — happy (writes concept_and_dna + creative_divergence, zero LLM)
- POST   /reset-and-restart  — idempotent
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.creative_os.b3_engine import (
    Dimension,
    DimensionDecomposition,
    RawIntent,
    B3Engine,
    B3State,
    Unit,
    atomic_write_state,
)
from backend.main import app
from backend.services.dimension_labels import Dimension as DimLabel

client = TestClient(app)

PROJ_PREFIX = "p_3b_"
BASE = "/api/v1/projects/{project_id}/creative/diverge/b3"


# ---------------------------------------------------------------------------
# Shared fakes / helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_router():
    """AsyncMock router — engine.replace_methods() can still await it."""
    return AsyncMock()


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    """Route all reads/writes to a per-test tmp dir."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


@pytest.fixture(autouse=True)
def _reset_engine_state():
    """Each test gets a fresh engine wired to a mock router."""
    yield
    if hasattr(app.state, "b3_engine"):
        del app.state.b3_engine


def _make_engine(mock_router: AsyncMock) -> B3Engine:
    return B3Engine(model_router=mock_router)


def _inject_engine(engine: B3Engine) -> None:
    app.state.b3_engine = engine


def _make_unit(
    unit_id: str,
    dim: Dimension,
    name: str = "u",
    description: str = "d",
) -> Unit:
    return Unit(
        id=unit_id,
        dimension=dim,
        unit_name=name,
        description=description,
    )


def _make_dim(
    dim: Dimension,
    units: list[Unit],
    candidates: list | None = None,
    insight: str = "i",
    status: str = "decomposed",
) -> DimensionDecomposition:
    return DimensionDecomposition(
        dimension=dim,
        insight=insight,
        units=units,
        candidates=list(candidates or []),
        dimension_status=status,  # type: ignore[arg-type]
    )


def _seed_basic_state(project_id: str, base: Path) -> B3State:
    """Seed a v3 state with 5 dimensions × 1 unit each. No candidates (S3 cut)."""
    u1 = _make_unit("unit_aaa", DimLabel.ONTOLOGY, name="灵窍", description="能量接口")
    u2 = _make_unit("unit_bbb", DimLabel.ENERGETICS, name="灵力", description="灵力流")
    u3 = _make_unit("unit_ccc", DimLabel.POWER_STRUCTURE, name="朝廷", description="权力结构")
    u4 = _make_unit("unit_ddd", DimLabel.PROTAGONIST_ENGINE, name="主角", description="金手指")
    u5 = _make_unit("unit_eee", DimLabel.NARRATIVE_PHYSICS, name="节奏", description="节奏")
    state = B3State(
        project_id=project_id,
        raw_intent=RawIntent(
            prompt="一个少年在废墟里觉醒",
            genre_primary="玄幻",
            tone="热血",
            style="爽文",
        ),
        causal_map="A → B",
        top_level_summary="一句话",
        dimensions=[
            _make_dim(DimLabel.ONTOLOGY, [u1]),
            _make_dim(DimLabel.ENERGETICS, [u2]),
            _make_dim(DimLabel.POWER_STRUCTURE, [u3]),
            _make_dim(DimLabel.PROTAGONIST_ENGINE, [u4]),
            _make_dim(DimLabel.NARRATIVE_PHYSICS, [u5]),
        ],
    )
    atomic_write_state(project_id, state)
    proj_dir = base / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    return state


def _route(path: str, project_id: str) -> str:
    return BASE.format(project_id=project_id) + path


# ---------------------------------------------------------------------------
# GET /state
# ---------------------------------------------------------------------------


def test_state_404_when_no_file():
    resp = client.get(_route("/state", f"{PROJ_PREFIX}none"))
    assert resp.status_code == 404
    assert "state 不存在" in resp.json()["detail"]


def test_state_returns_existing(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}get", tmp_path)
    resp = client.get(_route("/state", f"{PROJ_PREFIX}get"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["schema_version"] == 3
    assert data["raw_intent"]["prompt"] == "一个少年在废墟里觉醒"
    assert len(data["dimensions"]) == 5
    assert data["dimensions"][0]["units"][0]["unit_name"] == "灵窍"


def test_state_returns_404_for_v1_state_migrated_to_null(tmp_path):
    """A v1 state file on disk triggers migration → deletion → None."""
    proj_dir = tmp_path / f"{PROJ_PREFIX}v1"
    proj_dir.mkdir(parents=True)
    (proj_dir / "creative_os").mkdir()
    (proj_dir / "creative_os" / "b3_state.json").write_text(
        json.dumps({"schema_version": 1, "project_id": "p_3b_v1", "stage2_candidates": []}),
        encoding="utf-8",
    )
    resp = client.get(_route("/state", f"{PROJ_PREFIX}v1"))
    assert resp.status_code == 404
    # Migration deleted the v1 file
    assert not (proj_dir / "creative_os" / "b3_state.json").exists()


def test_state_loads_legacy_raw_intent_with_genre_secondary(tmp_path):
    """Disk state written before Round 1 included ``genre_secondary`` on
    raw_intent and lacked ``tone`` / ``style``. ``load_state`` must strip
    the legacy field and apply defaults instead of crashing HYDRATE with
    TypeError (the "S2 page empty after first decompose" bug).

    Regression for the proj_47007ffa "页面为空" report on 2026-09-10.
    """
    proj_id = f"{PROJ_PREFIX}legacy_intent"
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True)
    (proj_dir / "creative_os").mkdir()
    legacy = {
        "schema_version": 2,
        "project_id": proj_id,
        "raw_intent": {
            "prompt": "一个少年大病一场后获得了阴阳眼",
            "genre_primary": "xuanyi",
            "genre_secondary": None,
        },
        "causal_map": "ontology → energetics",
        "top_level_summary": "总览",
        "dimensions": [],
    }
    (proj_dir / "creative_os" / "b3_state.json").write_text(
        json.dumps(legacy, ensure_ascii=False),
        encoding="utf-8",
    )

    resp = client.get(_route("/state", proj_id))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["raw_intent"]["prompt"] == "一个少年大病一场后获得了阴阳眼"
    assert data["raw_intent"]["genre_primary"] == "xuanyi"
    assert "genre_secondary" not in data["raw_intent"]
    assert data["raw_intent"]["tone"] == ""
    assert data["raw_intent"]["style"] == ""


def test_state_loads_v2_legacy_with_cut_fields(tmp_path):
    """2026-09-19 S3/S4 cut:旧 v2 state 可能含 committed_concept /
    novelty_scores / diverge_started_at / commit_started_at 等已删字段。
    load_state 必须按 B3State dataclass fields 白名单丢弃多余字段,
    不让旧文件把 HYDRATE 拉炸。
    """
    proj_id = f"{PROJ_PREFIX}v2_legacy"
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True)
    (proj_dir / "creative_os").mkdir()
    legacy = {
        "schema_version": 2,
        "project_id": proj_id,
        "raw_intent": {"prompt": "测试旧字段", "genre_primary": "玄幻"},
        "causal_map": "",
        "top_level_summary": "",
        "dimensions": [],
        # 已被砍字段 — 必须被丢弃,不能让 B3State(**raw) 抛 TypeError
        "diverge_started_at": "2026-09-01T00:00:00Z",
        "diverge_completed_at": "2026-09-01T00:01:00Z",
        "commit_started_at": "2026-09-01T00:02:00Z",
        "commit_completed_at": "2026-09-01T00:03:00Z",
        "committed_concept": {"one_line": "x", "logline": "y"},
        "novelty_scores": {"composite": 0.5},
    }
    (proj_dir / "creative_os" / "b3_state.json").write_text(
        json.dumps(legacy, ensure_ascii=False),
        encoding="utf-8",
    )

    resp = client.get(_route("/state", proj_id))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 旧字段已被白名单过滤,响应里不应出现
    assert "diverge_started_at" not in data
    assert "diverge_completed_at" not in data
    assert "commit_started_at" not in data
    assert "commit_completed_at" not in data
    assert "committed_concept" not in data
    assert "novelty_scores" not in data
    # schema_version 仍为 2(读出来时磁盘文件原值),但 raw_intent 正常
    assert data["schema_version"] == 2
    assert data["raw_intent"]["prompt"] == "测试旧字段"


# ---------------------------------------------------------------------------
# DELETE /state
# ---------------------------------------------------------------------------


def test_state_delete_404_when_no_file():
    resp = client.delete(_route("/state", f"{PROJ_PREFIX}del_none"))
    assert resp.status_code == 404


def test_state_delete_removes_file(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}del", tmp_path)
    resp = client.delete(_route("/state", f"{PROJ_PREFIX}del"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    state_path = (
        tmp_path
        / f"{PROJ_PREFIX}del"
        / "creative_os"
        / "b3_state.json"
    )
    assert not state_path.exists()


# ---------------------------------------------------------------------------
# POST /decompose
# ---------------------------------------------------------------------------


def test_decompose_422_on_too_short_prompt():
    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_short"),
        json={"prompt": "短", "genre_primary": "玄幻"},
    )
    # Pydantic min_length=10 → 422 validation error
    assert resp.status_code == 422


def test_decompose_happy_path(mock_router):
    dims = [
        _make_dim(
            DimLabel.ONTOLOGY,
            [_make_unit("unit_aaa", DimLabel.ONTOLOGY)],
            insight="i1",
        ),
        _make_dim(
            DimLabel.ENERGETICS,
            [_make_unit("unit_bbb", DimLabel.ENERGETICS)],
            insight="i2",
        ),
        _make_dim(
            DimLabel.POWER_STRUCTURE,
            [_make_unit("unit_ccc", DimLabel.POWER_STRUCTURE)],
            insight="i3",
        ),
        _make_dim(
            DimLabel.PROTAGONIST_ENGINE,
            [_make_unit("unit_ddd", DimLabel.PROTAGONIST_ENGINE)],
            insight="i4",
        ),
        _make_dim(
            DimLabel.NARRATIVE_PHYSICS,
            [_make_unit("unit_eee", DimLabel.NARRATIVE_PHYSICS)],
            insight="i5",
        ),
    ]
    mock_router.execute = AsyncMock(return_value={"content": "{}"})
    engine = _make_engine(mock_router)

    captured: dict = {}

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["raw_intent"] = raw_intent
        captured["user_modifications"] = user_modifications
        return dims, "cmap", "summary"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_ok"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["dimensions"]) == 5
    assert data["causal_map"] == "cmap"
    assert data["top_level_summary"] == "summary"
    assert data["dimensions"][0]["dimension"] == "ontology"
    assert captured["raw_intent"].tone == "热血"
    assert captured["raw_intent"].style == "爽文"
    assert captured["raw_intent"].genre_primary == "玄幻"
    assert captured["user_modifications"] == ""


def test_decompose_forwards_user_modifications(mock_router):
    mock_router.execute = AsyncMock(return_value={"content": "{}"})

    dims = [_make_dim(DimLabel.ONTOLOGY, [])]
    engine = _make_engine(mock_router)

    captured: dict = {}

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["user_modifications"] = user_modifications
        return dims, "cm", "sum"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_mods"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "user_modifications": "聚焦东方玄幻,不要科幻",
        },
    )
    assert resp.status_code == 200
    assert captured["user_modifications"] == "聚焦东方玄幻,不要科幻"


def test_decompose_rejects_oversize_user_modifications():
    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_too_long"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "user_modifications": "x" * 2000,
        },
    )
    assert resp.status_code == 422


def test_decompose_omitted_tone_style_default_to_empty_string(mock_router):
    mock_router.execute = AsyncMock(return_value={"content": "{}"})
    engine = _make_engine(mock_router)
    captured: dict = {}

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["raw_intent"] = raw_intent
        return [], "cm", "sum"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_min"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 200
    assert captured["raw_intent"].tone == ""
    assert captured["raw_intent"].style == ""


def test_decompose_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        raise RuntimeError("LLM boom")

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_503"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 503
    assert "DECOMPOSE_FAILED" in resp.json()["detail"]


def test_decompose_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        raise ValueError("bad input")

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_422"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422


def test_decompose_applies_global_override_for_firstness_decompose(
    mock_router, tmp_path, monkeypatch
):
    """Regression: B3Engine must thread global/project override stores
    through to `load_prompt_effective`, otherwise Prompt Plaza edits
    silently no-op at runtime.
    """
    import json as _json
    from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
    from backend.services.prompt_override_store import PromptOverrideStore

    global_file = tmp_path / "global_prompt_overrides.json"
    global_file.write_text(
        _json.dumps(
            {
                "firstness_decompose": {
                    "system_prompt": "GLOBAL_OVERRIDE_MARKER_SYSTEM\n{negative_constraints}",
                    "user_prompt_template": "GLOBAL_OVERRIDE_MARKER_USER prompt={prompt} genre={genre_primary}",
                    "temperature": 0.42,
                    "max_tokens": 1234,
                    "_modified_at": "2026-09-11T00:00:00Z",
                }
            }
        ),
        encoding="utf-8",
    )

    global_store = GlobalPromptOverrideStore(
        global_overrides_path=global_file,
        prompts_dir=settings.prompts_dir,
    )
    project_store = PromptOverrideStore(
        projects_dir=tmp_path / "projects",
        prompts_dir=settings.prompts_dir,
    )

    captured: dict = {}

    async def fake_execute(*args, **kwargs):
        captured["messages"] = kwargs.get("messages")
        captured["temperature"] = kwargs.get("temperature")
        captured["max_tokens"] = kwargs.get("max_tokens")
        return {"content": "{}"}

    mock_router.execute = fake_execute
    engine = B3Engine(
        model_router=mock_router,
        override_store=project_store,
        global_override_store=global_store,
    )

    raw_intent = RawIntent(prompt="脑洞文字", genre_primary="玄幻", tone="热血", style="爽文")
    with pytest.raises(ValueError, match="LLM 返回 0 维度"):
        asyncio.run(engine.decompose("p_ovr", raw_intent))

    assert "messages" in captured, "router.execute was never called"
    system_msg, user_msg = captured["messages"][0], captured["messages"][1]
    assert "GLOBAL_OVERRIDE_MARKER_SYSTEM" in system_msg["content"]
    assert "GLOBAL_OVERRIDE_MARKER_USER" in user_msg["content"]
    assert captured["temperature"] == 0.42
    assert captured["max_tokens"] == 1234


# ---------------------------------------------------------------------------
# POST /follow-up
# ---------------------------------------------------------------------------


def test_follow_up_happy_path(mock_router):
    engine = _make_engine(mock_router)
    expected = Unit(
        id="unit_aaa",
        dimension=DimLabel.ONTOLOGY,
        unit_name="新名",
        description="新描述",
        follow_up_count=1,
    )

    async def fake_follow_up(project_id, unit_id, user_question, operator="none"):
        return expected

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_ok"),
        json={"unit_id": "unit_aaa", "user_question": "为什么"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["unit"]["id"] == "unit_aaa"
    assert data["unit"]["description"] == "新描述"


def test_follow_up_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_follow_up(project_id, unit_id, user_question, operator="none"):
        raise ValueError("unit 不可约化")

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_422"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 422
    assert "不可约化" in resp.json()["detail"]


def test_follow_up_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_follow_up(project_id, unit_id, user_question, operator="none"):
        raise RuntimeError("LLM down")

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_503"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /commit (zero-LLM synthesis)
# ---------------------------------------------------------------------------


def test_commit_happy_path_writes_both_files(mock_router, tmp_path):
    """commit 端点现在等价于「合成 concept_and_dna.json + creative_divergence.json」
    — 零 LLM,直接 deterministic 拼装。响应 shape:
      {concept_and_dna, creative_divergence, b3_state, committed_at}
    """
    proj_id = f"{PROJ_PREFIX}commit_ok"
    _seed_basic_state(proj_id, tmp_path)
    # seed project.json(current_stage=STAGE1) — commit 推进 STAGE1 → STAGE2。
    # 真实 wizard 流在 STAGE1 概念生成后到这一步前已经把 stage 推到 STAGE1。
    proj_dir = tmp_path / proj_id
    (proj_dir / "project.json").write_text(
        json.dumps({
            "id": proj_id, "title": "测试书名", "genre": "cool_novel",
            "current_stage": "STAGE1",
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(_route("/commit", proj_id))
    assert resp.status_code == 200
    data = resp.json()
    assert "concept_and_dna" in data
    assert "creative_divergence" in data
    assert "b3_state" in data
    assert "committed_at" in data

    # concept_and_dna 字段对齐下游 STAGE2~4 消费者
    dna = data["concept_and_dna"]
    assert dna["concept"]["premise"] == "一个少年在废墟里觉醒"[:1700]
    # 2026-09-20:title 取 project.json.title(用户书名),不再是 prompt[:80]。
    assert dna["concept"]["title"] == "测试书名"
    assert dna["concept"]["tone"] == "热血"
    assert dna["concept"]["theme"] == ""
    assert dna["story_dna"]["core_contradiction"]["statement"] == "一句话"
    assert dna["novelty_scores"] is None
    assert dna["source"] == "creative_divergence"
    assert dna["b3_snapshot"]["schema_version"] == 3

    # creative_divergence 字段
    assert data["creative_divergence"]["source"] == "creative_divergence"
    assert data["creative_divergence"]["selected_at"] == data["committed_at"]

    # b3_state schema v3 字段
    assert data["b3_state"]["schema_version"] == 3
    assert data["b3_state"]["committed_at"] == data["committed_at"]

    # 文件确实写盘
    proj_dir = tmp_path / f"{PROJ_PREFIX}commit_ok"
    on_disk_dna = json.loads((proj_dir / "concept_and_dna.json").read_text(encoding="utf-8"))
    on_disk_div = json.loads((proj_dir / "creative_divergence.json").read_text(encoding="utf-8"))
    assert on_disk_dna["concept"]["title"] == dna["concept"]["title"]
    assert on_disk_div["source"] == "creative_divergence"


def test_commit_truncates_long_prompt(mock_router, tmp_path):
    """prompt > 1700 → concept.premise 截断到 1700。

    2026-09-20:concept.title 现在取 project.json.title(测试中短于 80 时保留),
    不再 prompt[:80];所以本测试不再断言 title == 80 字符。
    """
    proj_id = f"{PROJ_PREFIX}commit_long"
    long_prompt = "x" * 3000
    state = B3State(
        project_id=proj_id,
        raw_intent=RawIntent(prompt=long_prompt, genre_primary="玄幻"),
        dimensions=[_make_dim(DimLabel.ONTOLOGY, [_make_unit("u", DimLabel.ONTOLOGY)])] * 0
            + [_make_dim(DimLabel.ENERGETICS, [_make_unit("u", DimLabel.ENERGETICS)])]
            + [_make_dim(DimLabel.POWER_STRUCTURE, [_make_unit("u", DimLabel.POWER_STRUCTURE)])]
            + [_make_dim(DimLabel.PROTAGONIST_ENGINE, [_make_unit("u", DimLabel.PROTAGONIST_ENGINE)])]
            + [_make_dim(DimLabel.NARRATIVE_PHYSICS, [_make_unit("u", DimLabel.NARRATIVE_PHYSICS)])],
        top_level_summary="一句话",
    )
    # 上面用了 *0 来强制构造 5 维;简化一下:
    state.dimensions = [
        _make_dim(DimLabel.ONTOLOGY, [_make_unit("u1", DimLabel.ONTOLOGY)]),
        _make_dim(DimLabel.ENERGETICS, [_make_unit("u2", DimLabel.ENERGETICS)]),
        _make_dim(DimLabel.POWER_STRUCTURE, [_make_unit("u3", DimLabel.POWER_STRUCTURE)]),
        _make_dim(DimLabel.PROTAGONIST_ENGINE, [_make_unit("u4", DimLabel.PROTAGONIST_ENGINE)]),
        _make_dim(DimLabel.NARRATIVE_PHYSICS, [_make_unit("u5", DimLabel.NARRATIVE_PHYSICS)]),
    ]
    atomic_write_state(proj_id, state)
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    # seed project.json + STAGE1,以满足 commit 推进 STAGE2 的前置
    (proj_dir / "project.json").write_text(
        json.dumps({
            "id": proj_id, "title": "我的长书名", "genre": "cool_novel",
            "current_stage": "STAGE1",
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(_route("/commit", proj_id))
    assert resp.status_code == 200
    dna = resp.json()["concept_and_dna"]
    assert len(dna["concept"]["premise"]) == 1700
    # title 现在是项目书名(短于 80,不截断)
    assert dna["concept"]["title"] == "我的长书名"


def test_commit_advances_project_to_STAGE2(mock_router, tmp_path):
    """commit 成功后,project.json.current_stage 必须推进到 STAGE2。

    否则下游 `/stage2/generate-world` 的前置检查
    (STAGE_ORDER.index(current) < STAGE_ORDER.index(STAGE2)) 会拒绝,
    WorldStep 自动调 generateWorld 直接 400。

    旧 Stage1Page 通过独立的「enter world+character」按钮调
    `api.advance(projectId, "STAGE2")` → /api/conductor/advance 推进;
    S2→世界观的合并让 commit 端点接管这个职责,这里锁住该契约。
    """
    proj_id = f"{PROJ_PREFIX}commit_advance"
    # seed state + project.json with explicit STAGE1 (or INIT) so the
    # advance() precondition's transition_check has a real from-stage
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    _seed_basic_state(proj_id, tmp_path)
    (proj_dir / "project.json").write_text(
        json.dumps({
            "id": proj_id,
            "title": "我的赛博朋克小说",
            "genre": "cool_novel",
            "current_stage": "STAGE1",
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(_route("/commit", proj_id))
    assert resp.status_code == 200, resp.text

    # commit 成功后,project.json.current_stage 必须推进到 STAGE2
    on_disk = json.loads((proj_dir / "project.json").read_text(encoding="utf-8"))
    assert on_disk["current_stage"] == "STAGE2", (
        f"commit 端点没推进 stage: current_stage={on_disk['current_stage']!r} "
        f"(应是 'STAGE2')。这会导致 WorldStep 的 generate-world 400s。"
    )


def test_commit_preserves_user_project_title(mock_router, tmp_path):
    """commit 合成的 concept.title 必须用用户创建项目时的标题(从 project.json 读),
    NOT raw_intent.prompt 的前 80 字符。

    旧 S4 由 LLM 生成 polished title;新确定性合成直接把 prompt 截断当 title,
    导致 `_resolve_display_title`(project.py:16)用 prompt 覆盖了用户起的书名 —
    书架上看到的是"一个赛博朋克 + 修仙的脑洞..."而非"我的赛博朋克小说"。
    """
    proj_id = f"{PROJ_PREFIX}commit_title"
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    _seed_basic_state(proj_id, tmp_path)
    # 用户的书名 vs 用户的 raw_intent.prompt(后者很长,前 80 字符作为 title 会很丑)
    user_title = "我的赛博朋克小说"
    (proj_dir / "project.json").write_text(
        json.dumps({
            "id": proj_id,
            "title": user_title,
            "genre": "cool_novel",
            "current_stage": "STAGE1",
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(_route("/commit", proj_id))
    assert resp.status_code == 200, resp.text

    dna = resp.json()["concept_and_dna"]
    assert dna["concept"]["title"] == user_title, (
        f"concept.title 被 raw prompt 覆盖了 — 用户的书名应被保留。"
        f"got title={dna['concept']['title']!r}, expected {user_title!r}"
    )


def test_commit_422_when_no_state(mock_router):
    engine = _make_engine(mock_router)

    async def fake_synth(project_id):
        raise ValueError("项目 p_3b_commit_no 无 state")

    engine.synthesize_concept_and_dna = fake_synth  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/commit", f"{PROJ_PREFIX}commit_no"))
    assert resp.status_code == 422


def test_commit_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_synth(project_id):
        raise RuntimeError("disk write failed")

    engine.synthesize_concept_and_dna = fake_synth  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/commit", f"{PROJ_PREFIX}commit_503"))
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /reset-and-restart (convenience)
# ---------------------------------------------------------------------------


def test_reset_and_restart_deletes_file(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}rr_del", tmp_path)
    resp = client.post(_route("/reset-and-restart", f"{PROJ_PREFIX}rr_del"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    state_path = (
        tmp_path
        / f"{PROJ_PREFIX}rr_del"
        / "creative_os"
        / "b3_state.json"
    )
    assert not state_path.exists()


def test_reset_and_restart_idempotent_when_no_file():
    resp = client.post(_route("/reset-and-restart", f"{PROJ_PREFIX}rr_none"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}


# ---------------------------------------------------------------------------
# Removed endpoints smoke-test (negative regression)
# ---------------------------------------------------------------------------


def test_diverge_endpoint_removed():
    """S3 自适应发散端点已删除 — 现在必须返回 404,而不是 422。"""
    resp = client.post(_route("/diverge", f"{PROJ_PREFIX}x"))
    assert resp.status_code == 404


def test_regenerate_unit_endpoint_removed():
    resp = client.post(
        _route("/regenerate-unit", f"{PROJ_PREFIX}x"),
        json={"unit_id": "u"},
    )
    assert resp.status_code == 404


def test_select_unit_endpoint_removed():
    resp = client.post(
        _route("/select-unit", f"{PROJ_PREFIX}x"),
        json={"unit_id": "u", "candidate_index": 0},
    )
    assert resp.status_code == 404


def test_edit_concept_endpoint_removed():
    resp = client.post(
        _route("/edit-concept", f"{PROJ_PREFIX}x"),
        json={"one_line": "x"},
    )
    assert resp.status_code == 404


def test_advance_endpoint_removed():
    resp = client.post(_route("/advance", f"{PROJ_PREFIX}x"))
    assert resp.status_code == 404