"""3B 创造力法则专用引擎(Wizard 「创意发散」3 阶段流程)。

三阶段:
  - diverge():  Stage 1→2 并行广度优先发散,3 算子 × 各自 3-5 子维度
  - deepen():   Stage 2→3 单候选二次算子深化(追加而非替换)
  - commit():   Stage 3 提交,LLM 合成 concept_and_dna + Novelty 评分

State 文件: <project>/creative_os/three_b_state.json
  与 canvas_state v3/v4 schema 完全隔离。
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.utils.file_manager import FileManager


def _file_manager() -> FileManager:
    """Return a FileManager resolved against the current settings.projects_dir.

    Defined locally (rather than imported from creative_diverge) so the engine
    doesn't depend on a FastAPI API module — tests that monkeypatch
    `settings.projects_dir` get a fresh manager via this helper.
    """
    return FileManager(settings.projects_dir)


STATE_FILE = "three_b_state.json"
STATE_DIR = "creative_os"

OPERATORS = ("breaking", "bending", "blending")
MAX_DEEPEN_COUNT_PER_CANDIDATE = 5
MAX_DEEPENED_IDS = 3
MIN_DEEPENED_IDS = 1


@dataclass
class RawIntent:
    prompt: str
    genre_primary: str
    genre_secondary: Optional[str] = None


@dataclass
class Candidate:
    id: str
    operator: str  # breaking | bending | blending
    sub_dimension: str
    sub_dimension_index: int
    premise_one_line: str
    rationale: str
    novelty_hook: str
    recognition_score: float = 0.0
    strangeness_score: float = 0.0
    llm_raw: str = ""
    regenerated_count: int = 0


@dataclass
class DeepenedCandidate:
    id: str
    source_candidate_id: str
    source_operator: str
    applied_operator: str
    applied_sub_dimension: str
    applied_sub_dimension_index: int
    premise_one_line: str
    rationale: str
    novelty_hook: str
    recognition_score: float = 0.0
    strangeness_score: float = 0.0
    llm_raw: str = ""
    deepen_count: int = 0


@dataclass
class ThreeBState:
    schema_version: int = 1
    project_id: str = ""
    raw_intent: Optional[RawIntent] = None
    stage1_completed_at: Optional[str] = None
    stage2_started_at: Optional[str] = None
    stage2_completed_at: Optional[str] = None
    stage2_candidates: list[Candidate] = field(default_factory=list)
    stage3_deepened: list[DeepenedCandidate] = field(default_factory=list)
    committed: bool = False
    committed_at: Optional[str] = None


def _state_path(project_id: str) -> Path:
    return (
        Path(settings.projects_dir)
        / project_id
        / STATE_DIR
        / STATE_FILE
    )


def atomic_write_state(project_id: str, state: ThreeBState) -> None:
    """Atomic write via .tmp + rename — leaves no .tmp files on success."""
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
        # Clean up the tmp file on any failure
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def load_state(project_id: str) -> Optional[ThreeBState]:
    """Load ThreeBState; returns None if state file missing.

    Reconstructs Candidate / DeepenedCandidate / RawIntent dataclasses from
    their dict representations — code that accesses `.id`, `.premise_one_line`
    etc. on these lists MUST round-trip through load_state for attribute access
    to work after persistence.
    """
    path = _state_path(project_id)
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("raw_intent"):
        raw["raw_intent"] = RawIntent(**raw["raw_intent"])
    raw["stage2_candidates"] = [
        Candidate(**c) for c in raw.get("stage2_candidates", [])
    ]
    raw["stage3_deepened"] = [
        DeepenedCandidate(**d) for d in raw.get("stage3_deepened", [])
    ]
    return ThreeBState(**raw)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:6]}"
