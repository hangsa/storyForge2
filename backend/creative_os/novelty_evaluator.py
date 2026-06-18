"""Novelty Evaluator — 新颖度评估器 (4 维评分, 75% 确定性)."""

import logging
from typing import Optional

import numpy as np

from backend.models.creative_os import NoveltyScore

logger = logging.getLogger(__name__)

CONTROVERSY_KEYWORDS: dict[str, int] = {
    "道德困境": 8, "身份政治": 7, "存在主义": 6,
    "宿命论": 6, "牺牲": 5, "背叛": 4,
}

PREDICTABILITY_KEYWORDS = [
    "打败", "获得了", "成功", "最终胜利", "变强", "升级",
    "碾压", "轻松", "顺利",
]


class NoveltyEvaluator:

    def __init__(self, trope_pool, contradiction_engine, model_router, embedder) -> None:
        self._trope_pool = trope_pool
        self._contradiction_engine = contradiction_engine
        self._router = model_router
        self._embedder = embedder

    def evaluate(self, content: str) -> NoveltyScore:
        # TODO(Phase 2): extract trope tags via Tier 3 LLM (trope_extraction.yaml)
        # and populate saturation_warnings / blue_ocean_tags on NoveltyScore.
        tags: list[str] = []  # LLM extraction deferred to Prompt availability
        mkt_score = self._calc_market_saturation(tags)

        embedding = self._embed_content(content)
        sim_score = self._calc_similarity(embedding)

        contra_score = self._contradiction_engine.score_depth(content)

        disc_score = self._calc_discussion_potential(content)

        total = (
            mkt_score * 0.30
            + sim_score * 0.25
            + contra_score * 0.25
            + disc_score * 0.20
        )

        grade = self._compute_grade(total)

        # TODO(Phase 2): populate saturation_warnings and blue_ocean_tags from
        # LLM-extracted tags + TropePool saturation analysis.
        return NoveltyScore(
            total=round(total, 1),
            market_saturation_score=round(mkt_score, 1),
            trope_similarity_score=round(sim_score, 1),
            contradiction_depth_score=round(contra_score, 1),
            discussion_potential_score=round(disc_score, 1),
            grade=grade,
        )

    def evaluate_node(self, node) -> NoveltyScore:
        return self.evaluate(node.content)

    def _embed_content(self, content: str) -> np.ndarray:
        if not content or not content.strip():
            return np.zeros(1024, dtype=np.float32)
        if self._embedder is not None and self._embedder.available:
            return self._embedder.embed_query(content)
        return np.zeros(1024, dtype=np.float32)

    def _calc_market_saturation(self, tags: list[str]) -> float:
        if not tags:
            return 50.0
        # TODO(Phase 2): apply Trope.novelty_penalty_weight to down-weight
        # high-penalty tropes in the saturation calculation.
        avg_sat = self._trope_pool.get_saturation_by_tags(tags)
        return round((1.0 - avg_sat) * 100, 1)

    def _calc_similarity(self, embedding: np.ndarray) -> float:
        if embedding.sum() == 0:
            return 50.0
        vector_index = self._trope_pool.get_vector_index()
        if not vector_index:
            return 50.0
        similarities = []
        for vec in vector_index.values():
            if vec.shape != embedding.shape:
                continue
            denom = np.linalg.norm(vec) * np.linalg.norm(embedding)
            if denom == 0:
                continue
            sim = float(np.dot(vec, embedding) / denom)
            similarities.append(max(-1.0, min(1.0, sim)))
        if not similarities:
            return 50.0
        max_sim = max(similarities)
        raw = (1.0 - max_sim) * 100
        return round(max(0.0, min(100.0, raw)), 1)

    def _calc_discussion_potential(self, text: str) -> float:
        if not text:
            return 0.0
        controversy_score = sum(
            weight for kw, weight in CONTROVERSY_KEYWORDS.items() if kw in text
        )
        predictability_penalty = sum(
            2 for kw in PREDICTABILITY_KEYWORDS if kw in text
        )
        raw = controversy_score - predictability_penalty
        return round(max(0.0, min(raw * 2.0, 100.0)), 1)

    def _compute_grade(self, total: float) -> str:
        if total >= 75:
            return "高新颖度"
        elif total >= 55:
            return "中等"
        elif total >= 35:
            return "偏低"
        else:
            return "低"
