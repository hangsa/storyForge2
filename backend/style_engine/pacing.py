"""PacingAnalyzer — deterministic compliance check for the genre `pacing` block.

Mirrors the shape of `WritingFormulaAnalyzer`: a sync analyze step followed
by a check_compliance step. No LLM is involved. Output feeds into
`ChapterReviewBuilder._check_pacing` as `pacing_compliance` entries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# SF_LOG tag regex — matches `<!-- SF_LOG <kind> ...` openers from scene_engine/log_spec.
SF_LOG_TAG_RE = re.compile(r"<!--\s*SF_LOG\s+[a-z_]+")

# Paragraph split — Chinese web novel convention is blank-line separation.
_PARAGRAPH_SPLIT_RE = re.compile(r"\n\s*\n")

# Chinese dialogue quotation marks (covers "smart" quotes and ASCII straight quotes).
_DIALOGUE_QUOTE_RE = re.compile(r"[“”\"「」]")

# Action-segment verb set. Tunable; see spec §4.1.
_ACTION_VERB_RE = re.compile(
    r"[挥砍刺击撞踢抓夺逃冲扑挡躲闪跃跳撕咬坠爆射轰奔飞弹"
    r"掀掣抬纵推袭攻引爆追击冲撞扑倒击杀斩杀毙命逃亡跃起"
    r"俯冲翻身搏斗厮杀驰骋追逐脱身挣脱阻拦]"
)

# Chinese character range (used for word counts — matches style_extractor._CHINESE_CHAR).
_CHINESE_CHAR_RE = re.compile(r"[一-鿿]")


def _char_count(text: str) -> int:
    return len(_CHINESE_CHAR_RE.findall(text))


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH_SPLIT_RE.split(text) if p.strip()]


@dataclass
class PacingStats:
    chapter_word_count: int = 0
    scene_word_counts: list[int] = field(default_factory=list)
    action_ratio: float = 0.0
    max_consecutive_non_action: int = 0
    sf_log_tags_per_1k: float = 0.0


@dataclass
class PacingCompliance:
    metric: str
    expected: str
    actual: str
    passed: bool
    delta_pct: float = 0.0


class PacingAnalyzer:
    """Deterministic analyzer + compliance checker for genre `pacing`."""

    def analyze_sync(self, scene_texts: list[str]) -> PacingStats:
        merged = "\n\n".join(t for t in scene_texts if t and t.strip())
        if not merged.strip():
            return PacingStats()

        chapter_word_count = _char_count(merged)
        scene_word_counts = [_char_count(t) for t in scene_texts if t and t.strip()]

        paragraphs = _split_paragraphs(merged)
        action_flags = [
            (not _DIALOGUE_QUOTE_RE.search(p)) and bool(_ACTION_VERB_RE.search(p))
            for p in paragraphs
        ]
        action_count = sum(1 for f in action_flags if f)
        action_ratio = round(action_count / max(1, len(action_flags)), 3)

        max_consecutive_non_action = 0
        current_run = 0
        for is_action in action_flags:
            if not is_action:
                current_run += 1
                if current_run > max_consecutive_non_action:
                    max_consecutive_non_action = current_run
            else:
                current_run = 0

        tag_count = len(SF_LOG_TAG_RE.findall(merged))
        sf_log_tags_per_1k = round(tag_count / (chapter_word_count / 1000), 3) if chapter_word_count else 0.0

        return PacingStats(
            chapter_word_count=chapter_word_count,
            scene_word_counts=scene_word_counts,
            action_ratio=action_ratio,
            max_consecutive_non_action=max_consecutive_non_action,
            sf_log_tags_per_1k=sf_log_tags_per_1k,
        )

    def check_compliance(
        self,
        stats: PacingStats,
        pacing: dict,
        tolerances: Optional[dict] = None,
    ) -> list[PacingCompliance]:
        # Implemented in Task 3.
        return []
