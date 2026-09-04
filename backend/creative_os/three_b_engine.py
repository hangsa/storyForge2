"""3B 创造力法则专用引擎(Wizard 「创意发散」3 阶段流程)。

三阶段:
  - diverge():  Stage 1→2 并行广度优先发散,3 算子 × 各自 3-5 子维度
  - deepen():   Stage 2→3 单候选二次算子深化(追加而非替换)
  - commit():   Stage 3 提交,LLM 合成 concept_and_dna + Novelty 评分

State 文件: <project>/creative_os/three_b_state.json
  与 canvas_state v3/v4 schema 完全隔离。
"""

from __future__ import annotations

import asyncio
import json
import json as _json
import logging
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.services.prompt_override_store import load_prompt_effective


def _file_manager() -> FileManager:
    """Return a FileManager resolved against the current settings.projects_dir.

    Defined locally (rather than imported from creative_diverge) so the engine
    doesn't depend on a FastAPI API module — tests that monkeypatch
    `settings.projects_dir` get a fresh manager via this helper.
    """
    return FileManager(settings.projects_dir)


logger = logging.getLogger(__name__)


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


class ThreeBEngine:
    """3B 创造力法则专用引擎。"""

    def __init__(self, model_router=None) -> None:
        self._router = model_router

    async def diverge(
        self, project_id: str, raw_intent: RawIntent
    ) -> dict:
        """3 个算子 asyncio.gather 并行发散,返回 candidates + by_operator。"""
        sem = asyncio.Semaphore(3)

        async def _guarded(op: str):
            async with sem:
                return await self._call_operator(op, raw_intent)

        results = await asyncio.gather(
            *[_guarded(op) for op in OPERATORS],
            return_exceptions=True,
        )

        by_operator: dict[str, list[Candidate]] = {op: [] for op in OPERATORS}
        for op, res in zip(OPERATORS, results):
            if isinstance(res, Exception):
                logger.warning("3B operator %s failed: %s", op, res)
                by_operator[op] = []
            else:
                by_operator[op] = res

        flat = [c for cs in by_operator.values() for c in cs]
        now = _now_iso()

        # Persist state (create if missing)
        state = load_state(project_id) or ThreeBState(project_id=project_id)
        state.raw_intent = raw_intent
        state.stage2_started_at = now
        state.stage2_completed_at = now
        state.stage2_candidates = flat
        atomic_write_state(project_id, state)

        return {
            "candidates": [asdict(c) for c in flat],
            "by_operator": {op: [asdict(c) for c in cs] for op, cs in by_operator.items()},
            "elapsed_ms": 0,  # placeholder; routers can compute if needed
        }

    async def _call_operator(
        self, operator: str, raw_intent: RawIntent
    ) -> list[Candidate]:
        """单算子 LLM 调用。"""
        prompt_data = load_prompt_effective(f"creative/three_b_{operator}")
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        response = await self._router.execute(
            agent_name="three_b",
            task_name=operator,
            messages=messages,
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.9),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        raw_text = response.get("content", "")
        cands = self._parse_operator_output(raw_text, operator)
        return cands

    def _parse_operator_output(
        self, raw_text: str, operator: str
    ) -> list[Candidate]:
        """Parse LLM JSON output → Candidate list with field coercion."""
        try:
            data = _json.loads(raw_text)
        except _json.JSONDecodeError:
            logger.warning("3B %s returned non-JSON; coercing to empty", operator)
            return []
        if not isinstance(data, list):
            return []
        out: list[Candidate] = []
        for idx, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            out.append(Candidate(
                id=_new_id("cand"),
                operator=operator,
                sub_dimension=item.get("sub_dimension", "") or "",
                sub_dimension_index=idx,
                premise_one_line=item.get("premise_one_line", "") or "",
                rationale=item.get("rationale", "") or "",
                novelty_hook=item.get("novelty_hook", "") or "",
                recognition_score=float(item.get("recognition_score", 0.0) or 0.0),
                strangeness_score=float(item.get("strangeness_score", 0.0) or 0.0),
                llm_raw=raw_text,
            ))
        return out
