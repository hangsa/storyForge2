"""Tests for Novelty Evaluator — 4-dimension scoring."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.creative_os.novelty_evaluator import (
    NoveltyEvaluator,
    _parse_trope_tags,
)
from backend.creative_os.trope_pool import TropePool


@pytest.fixture
def mock_embedder():
    m = MagicMock()
    m.VECTOR_DIM = 1024
    m.embed.return_value = np.random.randn(1, 1024).astype(np.float32)
    m.embed_query.return_value = np.random.randn(1024).astype(np.float32)
    m.available = True
    return m


@pytest.fixture
def mock_router():
    return MagicMock()


@pytest.fixture
def trope_pool(mock_embedder):
    d = tempfile.mkdtemp()
    pool = TropePool(Path(d), Path("config/trope_catalog.yaml"), embedder=mock_embedder)
    yield pool
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def contradiction_engine():
    return ContradictionEngine(model_router=None)


@pytest.fixture
def evaluator(trope_pool, contradiction_engine, mock_router, mock_embedder):
    return NoveltyEvaluator(
        trope_pool=trope_pool,
        contradiction_engine=contradiction_engine,
        model_router=mock_router,
        embedder=mock_embedder,
    )


class TestNoveltyEvaluator:

    def test_market_saturation_calculation(self, evaluator):
        score = evaluator._calc_market_saturation(["trope_001", "trope_003"])
        assert 0 <= score <= 100  # high-saturation tropes → low score

    def test_market_saturation_empty_tags(self, evaluator):
        score = evaluator._calc_market_saturation([])
        assert score == 50  # default neutral

    def test_similarity_calculation(self, evaluator):
        score = evaluator._calc_similarity(
            np.random.randn(1024).astype(np.float32)
        )
        assert 0 <= score <= 100

    def test_discussion_potential_calculation(self, evaluator):
        text = "这是一个关于道德困境和身份政治的故事，涉及存在主义的思考"
        score = evaluator._calc_discussion_potential(text)
        assert score > 0

    def test_discussion_potential_penalty(self, evaluator):
        predictable = "主角获得了强大的力量然后打败了坏人"
        unpredictable = "这是一个关于道德困境和身份政治的故事，涉及存在主义的思考"
        score1 = evaluator._calc_discussion_potential(predictable)
        score2 = evaluator._calc_discussion_potential(unpredictable)
        assert score2 > score1

    def test_evaluate_produces_valid_score(self, evaluator):
        content = ("主角林峰发现自己修炼的功法会加速世界毁灭，"
                   "但这是他唯一能保护所爱之人的方式。"
                   "他必须在力量与代价之间做出选择，"
                   "而他的真实身份一旦暴露，一切都将改变。")
        score = evaluator.evaluate(content)
        assert 0 <= score.total <= 100
        assert score.grade in {"高新颖度", "中等", "偏低", "低"}
        assert 0 <= score.market_saturation_score <= 100
        assert 0 <= score.trope_similarity_score <= 100
        assert 0 <= score.contradiction_depth_score <= 100
        assert 0 <= score.discussion_potential_score <= 100

    def test_evaluate_empty_content(self, evaluator):
        score = evaluator.evaluate("")
        assert 0 <= score.total <= 100

    def test_reproducibility(self, evaluator):
        content = "主角林峰发现了真相，面临道德困境和身份危机"
        scores = [evaluator.evaluate(content).total for _ in range(3)]
        assert max(scores) - min(scores) <= 4  # AC-3: ≤ 4 分差异

    def test_grade_thresholds(self, evaluator):
        content = "赛博修仙 非遗文化 克苏鲁 " * 10
        score = evaluator.evaluate(content)
        assert score.grade in {"高新颖度", "中等", "偏低", "低"}


class TestParseTropeTags:
    """_parse_trope_tags is the cleanup pass that runs after
    fill_trope_tags_async gets the LLM response. Reasoning models (MiniMax-M3)
    wrap their answer in <think>...</think> blocks; without the strip, naive
    comma-splitting surfaces English self-review fragments as tags. These
    tests pin the cleanup behavior so a regression reintroducing pollution
    fails loud."""

    def test_clean_comma_separated(self):
        # No think-block, plain comma-separated answer. Direct path.
        text = "修仙,异族入侵,反抗异族,神树降临,天道压制"
        assert _parse_trope_tags(text) == [
            "修仙", "异族入侵", "反抗异族", "神树降临", "天道压制",
        ]

    def test_full_width_comma(self):
        # Chinese users sometimes type the full-width form.
        assert _parse_trope_tags("修仙，异族入侵，反抗异族") == [
            "修仙", "异族入侵", "反抗异族",
        ]

    def test_strips_think_block(self):
        # Most important regression test: response with <think>...</think>
        # containing English self-review must not leak English fragments
        # into the saved tags. This is the pollution pattern that hit
        # proj_f0721bdc on 2026-08-31.
        text = (
            "<think>"
            "The user wants me to extract trope tags from this creative "
            "description about a fantasy world where an otherworldly "
            "invasion happened in ancient times and a divine tree called "
            "Jianmu descended to suppress the heavenly dao.\n\n"
            "Let me identify:\n- 异族入侵\n- 修仙\n"
            "alien invasion"
            "</think>"
            "\n\n修仙,异族入侵,远古秘辛,神树降临,镇压天道,仙侠"
        )
        tags = _parse_trope_tags(text)
        assert tags == ["修仙", "异族入侵", "远古秘辛", "神树降临", "镇压天道", "仙侠"]
        # No English tokens leaked through.
        assert all(all(ord(c) > 127 for c in t) for t in tags)

    def test_strips_parenthetical_asides(self):
        # Model leaves parenthetical English explanations inline.
        assert _parse_trope_tags("异族入侵 (alien invasion), 修仙 (cultivation), 神树降临") == [
            "异族入侵", "修仙", "神树降临",
        ]

    def test_answer_inside_think_block_falls_back_to_per_line(self):
        # Failure mode observed on proj_1a7d7fcf 2026-08-23: model puts the
        # whole answer inside the think block with no closing `</think>`.
        # Per-line CJK-density filter recovers the tags.
        text = (
            "<think>\n"
            "异族入侵\n"
            "alien invasion review note\n"
            "修仙,神树降临\n"
            "End of analysis.\n"
        )
        assert _parse_trope_tags(text) == ["异族入侵", "修仙", "神树降临"]

    def test_empty_and_whitespace(self):
        assert _parse_trope_tags("") == []
        assert _parse_trope_tags("   \n  ") == []

    def test_deduplicates_preserving_order(self):
        # The model occasionally repeats a tag at the start and end of its
        # answer. First-seen order wins.
        text = "修仙,异族入侵,修仙,异族入侵"
        assert _parse_trope_tags(text) == ["修仙", "异族入侵"]

    def test_trailing_punctuation(self):
        # Trailing commas / periods are common. They should not become
        # empty-string tags.
        assert _parse_trope_tags("修仙，异族入侵，") == ["修仙", "异族入侵"]
