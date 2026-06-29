"""Tier-3 preview renderer for the style sandbox.

Reuses StyleExtractor's helpers (_split_sentences, _DIALOGUE_PATTERN) for
sentence-splitting and dialogue detection to stay consistent with v1.6 style
analysis.
"""
from __future__ import annotations

import re

from backend.style_engine.sandbox_models import SandboxParams
from backend.style_engine.style_extractor import _split_sentences


def compute_avg_length(text: str) -> float:
    """Return average character count per sentence (Chinese-aware)."""
    sentences = _split_sentences(text)
    if not sentences:
        return 0.0
    # Exclude common Chinese/English punctuation from length count
    punct = "，。！？；：、,.!?;:\n\r\t "
    cleaned_lengths = [
        len(re.sub(f"[{re.escape(punct)}]", "", s))
        for s in sentences
    ]
    cleaned_lengths = [n for n in cleaned_lengths if n > 0]
    if not cleaned_lengths:
        return 0.0
    return sum(cleaned_lengths) / len(cleaned_lengths)


def _build_params_description(params: SandboxParams) -> str:
    """Convert SandboxParams to a Chinese-language description for the prompt."""
    s = params.sentence
    d = params.dialogue
    r = params.rhythm
    dens = params.density
    sat = params.satisfaction
    return (
        f"- 句长区间：{s.avg_length_range[0]}–{s.avg_length_range[1]} 字；短句占比 {s.short_sentence_ratio:.0%}；"
        f"段长 {s.paragraph_length_range[0]}–{s.paragraph_length_range[1]} 字\n"
        f"- 对白占比：{d.ratio:.0%}；连续对白 ≤ {d.max_consecutive_lines} 行\n"
        f"- 节奏：{r.pacing_bpm} BPM；场景切换频率 {r.scene_change_frequency:.0%}\n"
        f"- 描写/动作占比：{dens.description_ratio:.0%} / {dens.action_ratio:.0%}\n"
        f"- 爽点/钩子：{sat.satisfaction_beat_count} 处；悬念钩子{'必需' if sat.suspense_hook_required else '可选'}"
    )


# Preview rendering itself is implemented in Task 3 (depends on prompt YAML).
