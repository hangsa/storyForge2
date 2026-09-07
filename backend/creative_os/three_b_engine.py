"""4 阶段创意发散专用引擎(拆解 + 自适应发散 + 提交)。

四阶段:
  - decompose():          Stage 1→2 第一性拆解,1 次 LLM 调用产出 5 维度 + insight + causal_map + summary
  - follow_up_unit():     Stage 2 单元追问,原地替换 description
  - diverge():            Stage 2→3 per-unit 自适应发散,N units × 1 LLM 调用
  - regenerate_unit():    Stage 3 单 unit 重生成
  - select_unit_candidate(): Stage 3 切换候选
  - commit():             Stage 3→4 LLM 合成 5 字段 concept + novelty
  - edit_committed_concept(): Stage 4 用户编辑
  - advance():            Stage 4 写盘 concept_and_dna.json + creative_divergence.json

State 文件: <project>/creative_os/three_b_state.json, schema_version=2。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.services.dimension_labels import Dimension  # noqa: F401  (re-exported)
from backend.utils.file_manager import FileManager
from backend.services.prompt_override_store import load_prompt_effective
from backend.creative_os.novelty_evaluator import _parse_trope_tags


def _file_manager() -> FileManager:
    """Return a FileManager resolved against the current settings.projects_dir."""
    return FileManager(settings.projects_dir)


logger = logging.getLogger(__name__)


STATE_FILE = "three_b_state.json"
STATE_DIR = "creative_os"

OPERATORS = ("distort", "break", "blend", "chain")
ADAPTIVE_DIVERGE_PROMPT = "three_b_adaptive_diverge"
DECOMPOSE_PROMPT = "three_b_decompose"
COMMIT_PROMPT = "three_b_commit"
FOLLOW_UP_PROMPT = "three_b_follow_up"

MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT = 3  # < 3 units have candidates → /commit 拒绝
DIVERGE_CONCURRENCY = 5


@dataclass
class RawIntent:
    prompt: str
    genre_primary: str
    genre_secondary: Optional[str] = None


@dataclass
class Unit:
    """拆解产出的基本单元。"""
    id: str                           # "unit_<6hex>"
    dimension: Dimension
    unit_name: str                    # LLM 给的网文子域标签
    description: str
    follow_up_count: int = 0
    is_irreducible: bool = False


@dataclass
class UnitCandidate:
    """自适应发散引擎产出的单 unit 候选。"""
    id: str
    unit_id: str
    unit_name: str
    description: str
    chain_reaction: str               # 连锁推演
    main_operator: str                # "distort" | "break" | "blend" | "chain"
    aux_operator: Optional[str] = None
    selection_rank: int = 0           # 0..N-1,前端默认选中 0


@dataclass
class DimensionDecomposition:
    """单维度的完整状态。"""
    dimension: Dimension
    insight: str                      # 核心洞察
    units: list[Unit]
    candidates: list[UnitCandidate] = field(default_factory=list)
    dimension_status: str = "pending"  # pending | decomposed | diverged | divergence_failed


@dataclass
class ThreeBState:
    """schema_version=2 的全局状态。"""
    schema_version: int = 2
    project_id: str = ""
    raw_intent: Optional[RawIntent] = None

    # Stage 2 拆解
    decompose_started_at: Optional[str] = None
    decompose_completed_at: Optional[str] = None
    causal_map: str = ""
    top_level_summary: str = ""
    dimensions: list[DimensionDecomposition] = field(default_factory=list)

    # Stage 3 发散
    diverge_started_at: Optional[str] = None
    diverge_completed_at: Optional[str] = None

    # Stage 4 提交
    commit_started_at: Optional[str] = None
    commit_completed_at: Optional[str] = None
    committed_concept: Optional[dict] = None
    novelty_scores: Optional[dict] = None


def _state_path(project_id: str) -> Path:
    return (
        Path(settings.projects_dir)
        / project_id
        / STATE_DIR
        / STATE_FILE
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


def atomic_write_state(project_id: str, state: ThreeBState) -> None:
    """Atomic write via .tmp + rename."""
    path = _state_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(state)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{STATE_FILE}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def load_state(project_id: str) -> Optional[ThreeBState]:
    """Load ThreeBState; returns None if state file missing.

    Round-trip dataclasses for Unit / UnitCandidate / DimensionDecomposition / RawIntent.
    """
    path = _state_path(project_id)
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("raw_intent"):
        raw["raw_intent"] = RawIntent(**raw["raw_intent"])
    raw["dimensions"] = [
        _rebuild_dimension(d) for d in raw.get("dimensions", [])
    ]
    return ThreeBState(**raw)


def _rebuild_dimension(raw: dict) -> DimensionDecomposition:
    """Round-trip DimensionDecomposition from dict, including nested dataclasses."""
    return DimensionDecomposition(
        dimension=Dimension(raw["dimension"]),
        insight=raw.get("insight", ""),
        units=[Unit(**u) for u in raw.get("units", [])],
        candidates=[UnitCandidate(**c) for c in raw.get("candidates", [])],
        dimension_status=raw.get("dimension_status", "pending"),
    )


def migrate_state_on_load(project_id: str) -> Optional[ThreeBState]:
    """Load state with v1→v2 migration: delete old file, return None.

    Spec §5: 直接删除 v1 文件,强制用户重走。无 banner,前端收 null 后弹一次性 toast。
    """
    path = _state_path(project_id)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("three_b state unreadable, deleting: %s", project_id)
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return None
    if raw.get("schema_version") == 2:
        return load_state(project_id)
    # v1 → v2: 直接删除
    try:
        path.unlink()
        logger.info("v1→v2 migration: deleted old three_b_state.json for %s", project_id)
    except FileNotFoundError:
        pass
    return None


class ThreeBEngine:
    """4 阶段创意发散引擎。Tasks 3-9 will populate engine methods."""

    def __init__(self, model_router=None) -> None:
        self._router = model_router