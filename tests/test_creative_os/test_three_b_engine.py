"""ThreeBEngine diverge / deepen / commit unit tests (LLM mocked)."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.creative_os.three_b_engine import (
    ThreeBEngine,
    ThreeBState,
    Candidate,
    DeepenedCandidate,
    RawIntent,
    atomic_write_state,
)


@pytest.fixture
def mock_router():
    router = MagicMock()
    router.execute = AsyncMock()
    return router


def _llm_response(candidates: list[dict]) -> dict:
    """Mock the LLM router's return shape."""
    return {
        "content": json.dumps(candidates, ensure_ascii=False),
        "usage": {"input": 100, "output": 200},
    }


@pytest.mark.asyncio
async def test_diverge_calls_three_operators_in_parallel(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    # Three different responses, one per operator call
    mock_router.execute.side_effect = [
        _llm_response([{"sub_dimension": "打破线性/时间顺序", "premise_one_line": "x1",
                         "rationale": "y1", "novelty_hook": "z1"}]),
        _llm_response([{"sub_dimension": "尺度扭曲", "premise_one_line": "x2",
                         "rationale": "y2", "novelty_hook": "z2"}]),
        _llm_response([{"sub_dimension": "物种/实体融合", "premise_one_line": "x3",
                         "rationale": "y3", "novelty_hook": "z3"}]),
    ]

    engine = ThreeBEngine(model_router=mock_router)
    raw_intent = RawIntent(prompt="修仙对抗外星文明", genre_primary="修仙", genre_secondary="星际")
    result = await engine.diverge("p1", raw_intent)

    # 3 LLM calls (one per operator)
    assert mock_router.execute.await_count == 3
    # by_operator has all 3 keys
    assert set(result["by_operator"].keys()) == {"breaking", "bending", "blending"}
    # candidates aggregated
    assert len(result["candidates"]) == 3
    # Each operator produced exactly 1 candidate
    assert len(result["by_operator"]["breaking"]) == 1
    assert len(result["by_operator"]["bending"]) == 1
    assert len(result["by_operator"]["blending"]) == 1


@pytest.mark.asyncio
async def test_diverge_continues_when_one_operator_fails(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    mock_router.execute.side_effect = [
        _llm_response([{"sub_dimension": "打破因果/逻辑规则", "premise_one_line": "ok",
                         "rationale": "ok", "novelty_hook": "ok"}]),
        RuntimeError("LLM timeout"),
        _llm_response([{"sub_dimension": "身份/角色融合", "premise_one_line": "ok2",
                         "rationale": "ok2", "novelty_hook": "ok2"}]),
    ]

    engine = ThreeBEngine(model_router=mock_router)
    raw_intent = RawIntent(prompt="test prompt long enough", genre_primary="玄幻", genre_secondary=None)
    result = await engine.diverge("p1", raw_intent)

    # bending failed but breaking + blending still present
    assert result["by_operator"]["breaking"] and result["by_operator"]["blending"]
    assert result["by_operator"]["bending"] == []
    assert len(result["candidates"]) == 2


@pytest.mark.asyncio
async def test_diverge_writes_state_file(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    mock_router.execute.side_effect = [
        _llm_response([{"sub_dimension": "打破边界/分类", "premise_one_line": "a",
                         "rationale": "b", "novelty_hook": "c"}]),
        _llm_response([{"sub_dimension": "数量/密度扭曲", "premise_one_line": "d",
                         "rationale": "e", "novelty_hook": "f"}]),
        _llm_response([{"sub_dimension": "文化/时代融合", "premise_one_line": "g",
                         "rationale": "h", "novelty_hook": "i"}]),
    ]

    engine = ThreeBEngine(model_router=mock_router)
    raw_intent = RawIntent(prompt="another test prompt", genre_primary="奇幻", genre_secondary=None)
    await engine.diverge("p1", raw_intent)

    from backend.creative_os.three_b_engine import load_state
    state = load_state("p1")
    assert state is not None
    assert state.raw_intent.prompt == "another test prompt"
    assert len(state.stage2_candidates) == 3
    assert state.stage2_started_at is not None
    assert state.stage2_completed_at is not None


@pytest.mark.asyncio
async def test_deepen_rejects_same_operator(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    # Seed state with a breaking candidate
    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage2_candidates=[
            Candidate(
                id="cand_a1",
                operator="breaking",
                sub_dimension="打破线性/时间顺序",
                sub_dimension_index=0,
                premise_one_line="倒叙",
                rationale="倒回去",
                novelty_hook="信息倒置",
            )
        ],
    )
    atomic_write_state("p1", state)

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="必须选择不同的算子"):
        await engine.deepen("p1", "cand_a1", "breaking")


@pytest.mark.asyncio
async def test_deepen_appends_to_state(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage2_candidates=[
            Candidate(
                id="cand_a1",
                operator="breaking",
                sub_dimension="打破线性/时间顺序",
                sub_dimension_index=0,
                premise_one_line="倒叙",
                rationale="倒回去",
                novelty_hook="信息倒置",
            )
        ],
    )
    atomic_write_state("p1", state)

    mock_router.execute.return_value = _llm_response([{
        "sub_dimension": "尺度扭曲",
        "premise_one_line": "压缩到一呼之间",
        "rationale": "把打破线性后的故事再尺度扭曲",
        "novelty_hook": "梦境密度的全篇倒叙",
    }])

    engine = ThreeBEngine(model_router=mock_router)
    deepened = await engine.deepen("p1", "cand_a1", "bending")

    assert deepened.source_candidate_id == "cand_a1"
    assert deepened.source_operator == "breaking"
    assert deepened.applied_operator == "bending"
    assert deepened.premise_one_line == "压缩到一呼之间"

    # State persisted with the deepening
    from backend.creative_os.three_b_engine import load_state
    state_after = load_state("p1")
    assert len(state_after.stage3_deepened) == 1
    assert state_after.stage3_deepened[0].id == deepened.id


@pytest.mark.asyncio
async def test_deepen_missing_candidate_raises(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    # Seed a state that has NO stage2 candidates — but exists, so the
    # missing-candidate path triggers instead of the no-state path.
    atomic_write_state(
        "p1",
        ThreeBState(
            project_id="p1",
            raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        ),
    )

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="不存在"):
        await engine.deepen("p1", "cand_does_not_exist", "bending")


@pytest.mark.asyncio
async def test_deepen_count_capped_at_5(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage2_candidates=[
            Candidate(id="cand_a1", operator="breaking",
                      sub_dimension="打破线性/时间顺序", sub_dimension_index=0,
                      premise_one_line="x", rationale="y", novelty_hook="z")
        ],
        stage3_deepened=[
            # 5 existing deepenings for this candidate — must use real
            # DeepenedCandidate dataclass so atomic_write_state's asdict() works.
            DeepenedCandidate(
                id=f"deep_{i}",
                source_candidate_id="cand_a1",
                source_operator="breaking",
                applied_operator="bending",
                applied_sub_dimension="尺度扭曲",
                applied_sub_dimension_index=0,
                premise_one_line=f"premise {i}",
                rationale=f"rationale {i}",
                novelty_hook=f"hook {i}",
                deepen_count=i + 1,
            )
            for i in range(5)
        ],
    )
    atomic_write_state("p1", state)

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="deepen_count"):
        await engine.deepen("p1", "cand_a1", "bending")


@pytest.mark.asyncio
async def test_commit_rejects_empty_ids(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage3_deepened=[],
    )
    atomic_write_state("p1", state)

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="1-3"):
        await engine.commit("p1", [])


@pytest.mark.asyncio
async def test_commit_rejects_more_than_3(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
    )
    atomic_write_state("p1", state)

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="1-3"):
        await engine.commit("p1", ["deep_1", "deep_2", "deep_3", "deep_4"])


@pytest.mark.asyncio
async def test_commit_rejects_missing_id(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    (tmp_path / "projects" / "p1" / "creative_os").mkdir(parents=True)

    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage3_deepened=[],
    )
    atomic_write_state("p1", state)

    engine = ThreeBEngine(model_router=mock_router)
    with pytest.raises(ValueError, match="不存在"):
        await engine.commit("p1", ["deep_missing"])


@pytest.mark.asyncio
async def test_commit_writes_three_files(mock_router, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", str(tmp_path / "projects"))
    proj = tmp_path / "projects" / "p1"
    proj.mkdir(parents=True)
    (proj / "creative_os").mkdir()

    from backend.creative_os.three_b_engine import DeepenedCandidate
    state = ThreeBState(
        project_id="p1",
        raw_intent=RawIntent(prompt="x" * 20, genre_primary="玄幻", genre_secondary=None),
        stage3_deepened=[
            DeepenedCandidate(
                id="deep_xyz", source_candidate_id="cand_a1", source_operator="breaking",
                applied_operator="bending", applied_sub_dimension="尺度扭曲",
                applied_sub_dimension_index=0,
                premise_one_line="压缩到一呼", rationale="xx", novelty_hook="yy",
            )
        ],
    )
    atomic_write_state("p1", state)

    # commit triggers 2 LLM calls:
    #   1) three_b_commit.yaml → synthesize concept
    #   2) trope_extraction → for novelty scoring
    mock_router.execute.side_effect = [
        # 1) concept synthesis
        {
            "content": json.dumps({
                "one_line": "一句话概念",
                "expanded": "展开描述",
                "core_tension": "核心张力",
                "tone": "暗黑悬疑",
                "logline": "主角发现…",
            }, ensure_ascii=False),
            "usage": {"input": 100, "output": 200},
        },
        # 2) trope_extraction (NoveltyEvaluator); returns empty list = no tropes detected
        {
            "content": json.dumps([], ensure_ascii=False),
            "usage": {"input": 50, "output": 50},
        },
    ]

    engine = ThreeBEngine(model_router=mock_router)
    result = await engine.commit("p1", ["deep_xyz"])

    # Writes the 3 files
    assert (proj / "concept_and_dna.json").exists()
    assert (proj / "creative_divergence.json").exists()
    assert (proj / "creative_os" / "three_b_state.json").exists()

    cad = json.loads((proj / "concept_and_dna.json").read_text(encoding="utf-8"))
    assert cad["source"] == "creative_divergence"
    assert cad["concept"]["one_line"] == "一句话概念"
    assert "logline" in cad["concept"]

    cd = json.loads((proj / "creative_divergence.json").read_text(encoding="utf-8"))
    assert cd["source"] == "creative_divergence"
    assert cd["prompt"] == "x" * 20  # compat with stage1_concept.py guard

    # state.committed flag flipped
    from backend.creative_os.three_b_engine import load_state
    s = load_state("p1")
    assert s.committed is True
    assert s.committed_at is not None
    assert s.stage3_deepened[0].id == "deep_xyz"  # dataclass reconstruction works
