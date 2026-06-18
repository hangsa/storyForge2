"""Branch Simulator v1.7 — 分支模拟数据模型."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class LLMInference:
    """LLM 推理结果，封装置信度标注."""
    content: str
    confidence: str          # "medium" | "low"
    model: str
    tokens_used: int = 0


@dataclass
class BranchSimulationReport:
    branch_point_description: str
    # 确定性部分（零 LLM）
    affected_chapter_range: tuple[int, int]   # (start_ch, end_ch)
    affected_characters: list[str] = field(default_factory=list)
    affected_foreshadowings: list[str] = field(default_factory=list)
    growth_curve_shifts: dict[str, int] = field(default_factory=dict)
    reader_metrics_projection: dict[str, str] = field(default_factory=dict)
    # LLM 推理部分
    tension_curve_projection: Optional[LLMInference] = None
    foreshadowing_risk_assessment: Optional[LLMInference] = None
    alternative_suggestions: Optional[LLMInference] = None
    # 元数据
    created_at: str = ""
    tokens_used_total: int = 0
