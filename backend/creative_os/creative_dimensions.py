"""题材 / 基调 / 风格 三维度数据模型。

数据形态见 spec §3.1。三个维度共用同一 store，靠 `DimensionKind`
("subject" | "tone" | "style") 区分。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


DimensionKind = Literal["subject", "tone", "style"]
EntryStatus = Literal["active", "inactive"]


@dataclass
class DimensionEntry:
    id: str                          # slug 风格，如 "xuanhuan" / "rexue" / "shuangwen"
    name: str                        # 中文标签，如 "玄幻"
    description: str = ""            # textarea 内容（可空字符串）
    status: EntryStatus = "active"
    family: Optional[str] = None     # 仅 subject 使用（"xuanhuan"、"dushi" 等族系）
    label_en: Optional[str] = None   # 仅 subject 使用
    order: int = 0                   # 列表排序权重，升序
    created_at: str = ""             # ISO 8601
    updated_at: str = ""             # ISO 8601


@dataclass
class DimensionsCatalog:
    """全量三个维度的容器。"""
    subject: list[DimensionEntry] = field(default_factory=list)
    tone:    list[DimensionEntry] = field(default_factory=list)
    style:   list[DimensionEntry] = field(default_factory=list)


class DimensionEntryPayload(BaseModel):
    """POST/PUT 校验：name + 可选 description/status/family/label_en/order。"""

    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=2000)
    status: EntryStatus = "active"
    family: Optional[str] = Field(default=None, max_length=64)
    label_en: Optional[str] = Field(default=None, max_length=128)
    order: int = Field(default=0, ge=0, le=9999)

    model_config = ConfigDict(extra="forbid")


VALID_KINDS: tuple[str, ...] = ("subject", "tone", "style")
