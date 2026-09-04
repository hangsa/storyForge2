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

    async def deepen(
        self,
        project_id: str,
        candidate_id: str,
        applied_operator: str,
    ) -> DeepenedCandidate:
        """单候选二次算子深化,追加到 state.stage3_deepened[]。"""
        if applied_operator not in OPERATORS:
            raise ValueError(f"applied_operator 必须是 {OPERATORS} 之一")
        state = load_state(project_id)
        if state is None:
            raise ValueError(f"项目 {project_id} 尚未发散,无候选可深化")
        source = next(
            (c for c in state.stage2_candidates if c.id == candidate_id), None
        )
        if source is None:
            raise ValueError(f"candidate {candidate_id} 不存在")
        if applied_operator == source.operator:
            raise ValueError("必须选择不同的算子(applied_operator != source_operator)")

        existing_for_source = [
            d for d in state.stage3_deepened if d.source_candidate_id == candidate_id
        ]
        if len(existing_for_source) >= MAX_DEEPEN_COUNT_PER_CANDIDATE:
            raise ValueError(
                f"candidate {candidate_id} 已达 deepen_count 上限 "
                f"{MAX_DEEPEN_COUNT_PER_CANDIDATE}"
            )

        deepened = await self._deepen_candidate(state.raw_intent, source, applied_operator)

        state.stage3_deepened.append(deepened)
        atomic_write_state(project_id, state)
        return deepened

    async def _deepen_candidate(
        self,
        raw_intent: RawIntent,
        source: Candidate,
        applied_operator: str,
    ) -> DeepenedCandidate:
        prompt_data = load_prompt_effective(f"creative/three_b_{applied_operator}")
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
        )
        # Inject source candidate context into user prompt
        user += (
            f"\n\n## 待深化的源候选(来自 {source.operator})\n"
            f"- premise_one_line: {source.premise_one_line}\n"
            f"- rationale: {source.rationale}\n"
            f"- novelty_hook: {source.novelty_hook}\n"
            f"\n请基于这个源候选,选 1 个最值得展开的「{applied_operator}」子维度深化。"
            f"输出 JSON 数组(长度为 1),元素结构同常规要求。"
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        response = await self._router.execute(
            agent_name="three_b",
            task_name=f"{applied_operator}_deepen",
            messages=messages,
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.9),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        raw_text = response.get("content", "")
        items = self._parse_operator_output(raw_text, applied_operator)
        if not items:
            raise ValueError(f"3B deepen({applied_operator}) returned empty")
        item = items[0]
        return DeepenedCandidate(
            id=_new_id("deep"),
            source_candidate_id=source.id,
            source_operator=source.operator,
            applied_operator=applied_operator,
            applied_sub_dimension=item.sub_dimension,
            applied_sub_dimension_index=item.sub_dimension_index,
            premise_one_line=item.premise_one_line,
            rationale=item.rationale,
            novelty_hook=item.novelty_hook,
            recognition_score=item.recognition_score,
            strangeness_score=item.strangeness_score,
            llm_raw=raw_text,
            deepen_count=1,
        )

    async def commit(
        self,
        project_id: str,
        deepened_ids: list[str],
    ) -> dict:
        """LLM 合成单一 concept,落盘 concept_and_dna.json + creative_divergence.json。"""
        if not (MIN_DEEPENED_IDS <= len(deepened_ids) <= MAX_DEEPENED_IDS):
            raise ValueError(
                f"deepened_ids 数量必须是 {MIN_DEEPENED_IDS}-{MAX_DEEPENED_IDS},"
                f"当前 {len(deepened_ids)}"
            )
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError("项目尚未发散,无法 commit")

        by_id = {d.id: d for d in state.stage3_deepened}
        missing = [d_id for d_id in deepened_ids if d_id not in by_id]
        if missing:
            raise ValueError(f"deepened_ids 引用不存在: {missing}")
        chosen = [by_id[d_id] for d_id in deepened_ids]

        # Stage 3 LLM synthesis
        concept = await self._synthesize_concept(state.raw_intent, chosen)

        # Novelty evaluation: best-effort Tier 3 trope_extraction via router.
        # Skips the full NoveltyEvaluator pipeline (which needs TropePool +
        # ContradictionEngine + embedder) and computes a 4-dim summary from
        # the LLM-extracted trope list + neutral defaults. Same shape as
        # creative_diverge.py:_regenerate_concept_novelty payload so the
        # downstream UI doesn't need a different parser.
        novelty = await self._compute_novelty_scores(concept.get("expanded", ""))

        # 1) concept_and_dna.json
        now = _now_iso()
        concept_payload = {
            "concept": concept,
            "source": "creative_divergence",
            "three_b_snapshot": {
                "deepened_ids": deepened_ids,
                "committed_at": now,
            },
        }
        _file_manager().write_json(project_id, "concept_and_dna.json", concept_payload)

        # 2) creative_divergence.json (compat with stage1_concept.py guard)
        cd_compat = {
            "prompt": (state.raw_intent.prompt or "")[:1700],
            "variants": [],
            "selected_id": None,
            "selected_at": now,
            "source": "creative_divergence",
        }
        _file_manager().write_json(project_id, "creative_divergence.json", cd_compat)

        # 3) Flip state.committed
        state.committed = True
        state.committed_at = now
        atomic_write_state(project_id, state)

        return {
            "concept_and_dna": concept,
            "novelty_scores": novelty,
            "message": "概念已写入 concept_and_dna.json",
        }

    async def _synthesize_concept(
        self, raw_intent: RawIntent, chosen: list[DeepenedCandidate]
    ) -> dict:
        prompt_data = load_prompt_effective("creative/three_b_commit")
        system = prompt_data["system_prompt"].format(negative_constraints="")
        candidates_payload = [
            {
                "premise_one_line": d.premise_one_line,
                "rationale": d.rationale,
                "novelty_hook": d.novelty_hook,
                "source_operator": d.source_operator,
                "applied_operator": d.applied_operator,
            }
            for d in chosen
        ]
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
            deepened_candidates_json=json.dumps(candidates_payload, ensure_ascii=False, indent=2),
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        response = await self._router.execute(
            agent_name="three_b",
            task_name="commit",
            messages=messages,
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        raw_text = response.get("content", "")
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"three_b_commit returned non-JSON: {exc}") from exc

    async def _compute_novelty_scores(self, concept_text: str) -> dict:
        """Best-effort novelty scoring via Tier 3 trope_extraction LLM call.

        Mirrors `NoveltyEvaluator.fill_trope_tags_async`'s approach (direct
        router call, no TropePool dependency) but produces a payload shape
        compatible with `creative_diverge.py` `_regenerate_concept_novelty`
        so downstream consumers don't need a special case.

        All four 4-dim scores default to 50.0 (neutral) on any failure —
        the same fallback strategy used by `creative_diverge.py:_regen_*`
        when the evaluator is unavailable.
        """
        defaults = {
            "market_saturation": 50.0,
            "trope_similarity": 50.0,
            "contradiction_depth": 50.0,
            "discussion_potential": 50.0,
            "composite": 50.0,
            "grade": "中等",
            "trope_tags": [],
            "trope_extraction_status": "skipped",
        }
        try:
            prompt_data = load_prompt_effective("trope_extraction")
        except FileNotFoundError as exc:
            logger.warning("trope_extraction prompt missing: %s", exc)
            return defaults
        try:
            system = prompt_data.get("system_prompt", "").strip()
            user = prompt_data.get("user_prompt_template", "").format(prompt=concept_text or "")
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
            response = await self._router.execute(
                agent_name="novelty",
                task_name="trope_extraction",
                messages=messages,
                json_mode=True,
                temperature=prompt_data.get("temperature", 0.3),
                max_tokens=prompt_data.get("max_tokens", 512),
            )
            raw_text = response.get("content", "")
            trope_tags = json.loads(raw_text) if raw_text else []
            if not isinstance(trope_tags, list):
                trope_tags = []
        except Exception as exc:
            logger.warning("trope_extraction LLM call failed: %s", exc)
            return defaults

        # Lightweight heuristic: empty trope list → max-saturation-uncertainty
        # defaults (50.0). Non-empty list nudges market_saturation down
        # proportionally to detected tropes (more tropes → higher saturation).
        n = len(trope_tags)
        market_saturation = max(0.0, min(100.0, 50.0 - n * 5.0))
        composite = (
            market_saturation * 0.30
            + 50.0 * 0.25
            + 50.0 * 0.25
            + 50.0 * 0.20
        )
        grade = "高新颖度" if composite >= 75 else (
            "中等" if composite >= 55 else ("偏低" if composite >= 35 else "低")
        )
        return {
            "market_saturation": round(market_saturation, 1),
            "trope_similarity": 50.0,
            "contradiction_depth": 50.0,
            "discussion_potential": 50.0,
            "composite": round(composite, 1),
            "grade": grade,
            "trope_tags": trope_tags,
            "trope_extraction_status": "ok",
        }
