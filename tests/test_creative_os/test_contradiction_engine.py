"""Tests for Contradiction Engine -- deterministic scoring + template detection."""

from unittest.mock import MagicMock

import pytest

from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.models.creative_os import (ContradictionTemplate,
                                         ContradictionExpansion)


@pytest.fixture
def engine():
    return ContradictionEngine(model_router=None)


class TestDeterministicScoring:

    def test_score_depth_empty_text(self, engine):
        score = engine.score_depth("")
        assert score == 0

    def test_score_depth_with_single_template(self, engine):
        text = "主角拥有无敌的力量，但每次使用都会消耗寿命，这是他最大的限制"
        score = engine.score_depth(text)
        assert score > 0

    def test_score_depth_with_multiple_keywords(self, engine):
        text = ("主角拥有毁天灭地的能力，但限制是必须保守自己真实身份的"
                "秘密，一旦暴露就会付出代价。身份认同和力量之间的永恒"
                "矛盾让他在追求目标的路上不断挣扎。")
        score = engine.score_depth(text)
        assert score > 0

    def test_score_depth_compound_bonus(self, engine):
        text = ("她获得了永恒的生命，却看着挚爱一个个消逝。"
                "她的能力足以改变世界，却受限于无法触碰所爱之人的诅咒。"
                "这是力量作为弱点的终极悖论——她越强，越孤独。")
        score = engine.score_depth(text)
        assert 0 <= score <= 100

    def test_score_depth_max_cap(self, engine):
        text = "能力 限制 永恒 消逝 身份 秘密 目标 代价 力量 弱点 " * 20
        score = engine.score_depth(text)
        assert score <= 100

    def test_detect_templates_single(self, engine):
        text = "主角的能力越强，限制就越大，这是他必须面对的命运"
        results = engine.detect_templates(text)
        assert len(results) > 0
        assert results[0][0] == ContradictionTemplate.ABILITY_VS_LIMIT

    def test_detect_templates_multiple(self, engine):
        text = ("主角获得了永恒的生命，却无法暴露自己的真实身份，"
                "每次使用力量都会加速自身的消逝。")
        results = engine.detect_templates(text)
        assert len(results) >= 2

    def test_detect_templates_none(self, engine):
        results = engine.detect_templates("今天天气很好")
        assert len(results) == 0

    def test_detect_templates_power_as_weakness(self, engine):
        text = "他最强的力量恰恰是他最大的弱点，力量即弱点"
        results = engine.detect_templates(text)
        assert any(r[0] == ContradictionTemplate.POWER_AS_WEAKNESS for r in results)

    def test_score_depth_normalized_to_100(self, engine):
        text = "能力与限制永恒消逝身份秘密目标代价力量即弱点"
        score = engine.score_depth(text)
        assert 0 <= score <= 100


class TestContradictionEngineLLM:

    @pytest.mark.asyncio
    async def test_expand_calls_router(self):
        from unittest.mock import AsyncMock
        router = MagicMock()
        router.execute = AsyncMock(return_value={
            "content": '{"element_a": "能力", "element_b": "限制", '
                       '"core_tension": "核心张力描述", '
                       '"character_implications": ["影响1", "影响2"], '
                       '"plot_implications": ["情节1", "情节2"], '
                       '"thematic_depth": "主题深度"}',
            "usage": {"input": 400, "output": 300},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = ContradictionEngine(model_router=router)
        result = await engine.expand(
            ContradictionTemplate.ABILITY_VS_LIMIT, "测试上下文"
        )
        assert isinstance(result, ContradictionExpansion)
        assert result.template == ContradictionTemplate.ABILITY_VS_LIMIT
        assert result.core_tension == "核心张力描述"
        assert len(result.character_implications) == 2
        assert result.tokens_used == 700

    @pytest.mark.asyncio
    async def test_expand_without_router_raises(self):
        engine = ContradictionEngine(model_router=None)
        with pytest.raises(NotImplementedError):
            await engine.expand(ContradictionTemplate.ABILITY_VS_LIMIT)
