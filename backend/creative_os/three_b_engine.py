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
from typing import Literal, Optional

from backend.config import settings
from backend.services.dimension_labels import Dimension  # noqa: F401  (re-exported)
from backend.utils.file_manager import FileManager
from backend.services.prompt_override_store import load_prompt_effective


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

DimensionStatus = Literal["pending", "decomposed", "diverged", "divergence_failed"]

MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT = 3  # < 3 units have candidates → /commit 拒绝
DIVERGE_CONCURRENCY = 5

ALLOWED_EDIT_FIELDS = {"one_line", "expanded", "core_tension", "tone", "logline"}

# TODO(divergence): removed in Task 13 (routes rewrite). Kept as a shim to avoid
# breaking backend/api/three_b_routes.py imports between Task 2 and Task 13.
MAX_DEEPENED_IDS = 3
MIN_DEEPENED_IDS = 1


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
    dimension_status: DimensionStatus = "pending"


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


def _parse_json_or_raise(raw_text: str, op: str) -> dict:
    """Parse LLM JSON output; raise engine-friendly ValueError on failure."""
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"{op}: LLM 返回非 JSON: {e}") from e
    if not isinstance(data, dict):
        raise ValueError(f"{op}: LLM 输出不是 dict")
    return data


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

    def __init__(self, model_router=None, novelty_evaluator=None) -> None:
        self._router = model_router
        self._novelty_evaluator = novelty_evaluator

    async def decompose(
        self, project_id: str, raw_intent: RawIntent
    ) -> tuple[list[DimensionDecomposition], str, str]:
        """1 LLM call → (dimensions, causal_map, top_level_summary)."""
        started_at = _now_iso()
        response = await self._invoke_llm_json(
            DECOMPOSE_PROMPT, "decompose",
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
        )
        raw_text = response.get("content", "")
        dims, causal_map, summary = self._parse_decompose_output(raw_text)
        completed_at = _now_iso()
        state = load_state(project_id) or ThreeBState(project_id=project_id)
        # 清空下游(decompose 自身的 dimensions 字段会被覆盖)
        state.dimensions = dims
        state.causal_map = causal_map
        state.top_level_summary = summary
        state.raw_intent = raw_intent
        state.decompose_started_at = started_at
        state.decompose_completed_at = completed_at
        # 下游清空
        for d in state.dimensions:
            d.candidates = []
            d.dimension_status = "decomposed"
        state.diverge_started_at = None
        state.diverge_completed_at = None
        state.committed_concept = None
        state.novelty_scores = None
        state.commit_started_at = None
        state.commit_completed_at = None
        atomic_write_state(project_id, state)
        return state.dimensions, state.causal_map, state.top_level_summary

    def _parse_decompose_output(self, raw_text: str) -> tuple[list[DimensionDecomposition], str, str]:
        data = _parse_json_or_raise(raw_text, "decompose")
        dims_raw = data.get("dimensions", [])
        if len(dims_raw) != 5:
            raise ValueError(f"decompose: LLM 返回 {len(dims_raw)} 维度,需 5")
        dims: list[DimensionDecomposition] = []
        for d in dims_raw:
            dim_str = d.get("dimension", "")
            try:
                dim = Dimension(dim_str)
            except ValueError as e:
                raise ValueError(f"decompose: 未知 dimension '{dim_str}'") from e
            units = [
                Unit(
                    id=_new_id("unit"),
                    dimension=dim,
                    unit_name=u.get("unit_name", "") or "",
                    description=u.get("description", "") or "",
                )
                for u in d.get("units", [])
                if isinstance(u, dict)
            ]
            dims.append(DimensionDecomposition(
                dimension=dim,
                insight=d.get("insight", "") or "",
                units=units,
                dimension_status="decomposed",
            ))
        causal_map = data.get("causal_map", "") or ""
        top_level_summary = data.get("top_level_summary", "") or ""
        return dims, causal_map, top_level_summary

    def _build_prompt_messages(self, prompt_name: str, **fmt) -> tuple[str, str]:
        """Load + format a v2 prompt. Returns (system, user) messages.

        Negative constraints are always substituted with empty string.
        All other format kwargs are passed through to user_prompt_template.
        """
        prompt_data = load_prompt_effective(prompt_name)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(**fmt)
        return system, user

    async def _invoke_llm_json(self, prompt_name: str, task_name: str, **fmt) -> dict:
        """Call the LLM with standard 3B envelope (json_mode, three_b agent).

        Returns the raw response dict from router.execute (caller is responsible
        for extracting/parsing content).
        """
        system, user = self._build_prompt_messages(prompt_name, **fmt)
        prompt_data = load_prompt_effective(prompt_name)
        return await self._router.execute(
            agent_name="three_b",
            task_name=task_name,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )

    async def follow_up_unit(
        self, project_id: str, unit_id: str, user_question: Optional[str]
    ) -> Unit:
        """LLM 原地替换 description,记录 follow_up_count。"""
        state = load_state(project_id)
        if state is None:
            raise ValueError(f"项目 {project_id} 未拆解")
        target = self._find_unit(state, unit_id)
        if target is None:
            raise ValueError(f"unit {unit_id} 不存在")
        if target.is_irreducible:
            raise ValueError(f"unit {unit_id} 已不可约化")

        response = await self._invoke_llm_json(
            FOLLOW_UP_PROMPT, "follow_up",
            unit_name=target.unit_name,
            description=target.description,
            user_question=user_question or "(无明确问题,请基于该单元当前描述做一次深化)",
        )
        raw = _parse_json_or_raise(response.get("content", ""), "follow_up_unit")
        target.description = raw.get("description", target.description) or target.description
        if raw.get("unit_name"):
            target.unit_name = raw["unit_name"]
        if raw.get("is_irreducible") is True:
            target.is_irreducible = True
        target.follow_up_count += 1
        atomic_write_state(project_id, state)
        return target

    async def diverge(self, project_id: str) -> list[DimensionDecomposition]:
        """对所有 units 并行调用自适应发散。N units × 1 LLM, asyncio.gather + Semaphore(5)。"""
        state = load_state(project_id)
        if state is None or not state.dimensions:
            raise ValueError(f"项目 {project_id} 未拆解")

        all_units = [(d, u) for d in state.dimensions for u in d.units]
        if not all_units:
            raise ValueError("无 units 可发散")

        sem = asyncio.Semaphore(DIVERGE_CONCURRENCY)

        async def _diverge_unit(dim: DimensionDecomposition, unit: Unit) -> list[UnitCandidate]:
            async with sem:
                return await self._diverge_single_unit(state.raw_intent, dim, unit)

        started_at = _now_iso()
        tasks = [_diverge_unit(d, u) for d, u in all_units]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        completed_at = _now_iso()

        # 全部失败检查(写盘前,失败时不落任何状态)
        if all(isinstance(res, BaseException) or not res for res in results):
            raise RuntimeError("全部 unit 发散失败")

        # 组装 candidates 到对应 dimension(整轮重跑 → 先清空,避免重复累积)
        for dim in state.dimensions:
            dim.candidates = []
        for (dim, unit), res in zip(all_units, results):
            if isinstance(res, BaseException):
                logger.warning("diverge unit %s failed: %s", unit.id, res)
                continue
            dim.candidates.extend(res)

        # dimension_status 推算:该维度所有 unit 的 candidates 汇总
        for dim in state.dimensions:
            dim.dimension_status = "diverged" if dim.candidates else "divergence_failed"

        state.diverge_started_at = started_at
        state.diverge_completed_at = completed_at
        # 下游清空
        state.committed_concept = None
        state.novelty_scores = None
        state.commit_started_at = None
        state.commit_completed_at = None
        atomic_write_state(project_id, state)
        return state.dimensions

    async def _diverge_single_unit(
        self, raw_intent: Optional[RawIntent], dim: DimensionDecomposition, unit: Unit
    ) -> list[UnitCandidate]:
        if raw_intent is None:
            return []
        response = await self._invoke_llm_json(
            ADAPTIVE_DIVERGE_PROMPT, "diverge_unit",
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
            dimension=dim.dimension.value,
            unit_name=unit.unit_name,
            unit_description=unit.description,
        )
        return self._parse_adaptive_diverge_output(response.get("content", ""), unit)

    def _parse_adaptive_diverge_output(self, raw_text: str, unit: Unit) -> list[UnitCandidate]:
        """Parse per-unit divergence output. Degrades to [] instead of raising."""
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            logger.warning("adaptive_diverge returned non-JSON for unit %s", unit.id)
            return []
        cands_raw = data.get("candidates", []) if isinstance(data, dict) else data
        if not isinstance(cands_raw, list):
            return []
        out: list[UnitCandidate] = []
        for c in cands_raw:
            if not isinstance(c, dict):
                continue
            main_op = c.get("main_operator", "")
            if main_op not in OPERATORS:
                logger.warning(
                    "adaptive_diverge: unit %s candidate has bad main_operator %r, skipped",
                    unit.id, main_op,
                )
                continue
            if "chain_reaction" not in c:
                logger.warning(
                    "adaptive_diverge: unit %s candidate missing chain_reaction, skipped", unit.id
                )
                continue
            aux = c.get("aux_operator")
            if aux is not None and aux not in OPERATORS:
                aux = None
            try:
                rank = int(c.get("selection_rank", 0))
            except (TypeError, ValueError):
                rank = 0
            out.append(UnitCandidate(
                id=_new_id("cand"),
                unit_id=unit.id,
                unit_name=unit.unit_name,
                description=c.get("description", "") or "",
                chain_reaction=c.get("chain_reaction", "") or "",
                main_operator=main_op,
                aux_operator=aux,
                selection_rank=rank,
            ))
        return out

    def _find_unit(self, state: ThreeBState, unit_id: str) -> Optional[Unit]:
        for d in state.dimensions:
            for u in d.units:
                if u.id == unit_id:
                    return u
        return None

    def _find_unit_with_dim(
        self, state: ThreeBState, unit_id: str
    ) -> Optional[tuple[DimensionDecomposition, Unit]]:
        """Find unit + its parent dim. Returns (dim, unit) or None."""
        for d in state.dimensions:
            for u in d.units:
                if u.id == unit_id:
                    return (d, u)
        return None

    async def regenerate_unit(self, project_id: str, unit_id: str) -> list[UnitCandidate]:
        """重跑该 unit 的发散,只替换该 unit 的 candidates。"""
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError(f"项目 {project_id} 未发散")
        found = self._find_unit_with_dim(state, unit_id)
        if found is None:
            raise ValueError(f"unit {unit_id} 不存在")
        target_dim, target_unit = found

        new_cands = await self._diverge_single_unit(state.raw_intent, target_dim, target_unit)
        if not new_cands:
            raise ValueError("regenerate_unit: LLM 未返回候选")

        # 替换 target_dim.candidates 中属于该 unit 的部分
        target_dim.candidates = [c for c in target_dim.candidates if c.unit_id != unit_id] + new_cands
        target_dim.dimension_status = "diverged" if target_dim.candidates else "divergence_failed"
        # 下游清空(镜像 diverge)
        state.committed_concept = None
        state.novelty_scores = None
        state.commit_started_at = None
        state.commit_completed_at = None
        atomic_write_state(project_id, state)
        return new_cands

    def select_unit_candidate(
        self, project_id: str, unit_id: str, candidate_index: int
    ) -> DimensionDecomposition:
        """切换 selection_rank 指向 candidate_index(纯本地操作)。"""
        state = load_state(project_id)
        if state is None:
            raise ValueError(f"项目 {project_id} 无 state")
        for d in state.dimensions:
            cands = [c for c in d.candidates if c.unit_id == unit_id]
            if not cands:
                continue
            if candidate_index >= len(cands):
                raise ValueError(f"candidate_index {candidate_index} 超出范围 (该 unit 有 {len(cands)} 候选)")
            # 把 target rank swap 到 0,原 rank=0 移到 target
            target = cands[candidate_index]
            current_zero = next((c for c in cands if c.selection_rank == 0), None)
            if current_zero is not None and current_zero.id != target.id:
                current_zero.selection_rank, target.selection_rank = target.selection_rank, 0
            elif current_zero is None:
                target.selection_rank = 0
            # 写回 d.candidates(替换该 unit 的候选列表)
            d.candidates = [c for c in d.candidates if c.unit_id != unit_id] + cands
            atomic_write_state(project_id, state)
            return d
        raise ValueError(f"unit {unit_id} 无候选")

    def _build_novelty_evaluator(self, project_id: str):
        """Construct a NoveltyEvaluator mirroring `v2_canvas._build_novelty_evaluator`.

        Allows caller to inject a pre-built evaluator via `__init__(novelty_evaluator=...)`
        for tests; falls back to the standard TropePool + ContradictionEngine wiring.
        `model_router` and `embedder` are None — only `fill_trope_tags_async` needs
        them, and that's not invoked from the commit path.
        """
        if self._novelty_evaluator is not None:
            return self._novelty_evaluator
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        from backend.creative_os.trope_pool import TropePool
        from backend.creative_os.contradiction_engine import ContradictionEngine

        project_dir = settings.projects_dir / project_id
        catalog_path = settings.projects_dir.parent / "config" / "trope_catalog.yaml"
        trope_pool = TropePool(project_dir=project_dir, catalog_path=catalog_path)
        return NoveltyEvaluator(
            trope_pool=trope_pool,
            contradiction_engine=ContradictionEngine(),
            model_router=None,
            embedder=None,
        )

    async def commit(self, project_id: str) -> dict:
        """LLM 合成 5 字段 concept + novelty。≥3 units 有候选才允许。"""
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError(f"项目 {project_id} 未发散")

        units_with_cands = sum(
            1
            for d in state.dimensions
            for u in d.units
            if any(c.unit_id == u.id for c in d.candidates)
        )
        if units_with_cands < MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT:
            raise ValueError(
                f"候选不足:{units_with_cands} units 有候选 "
                f"(< {MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT}),无法合成"
            )

        # Pre-load prompt + format system via the shared helper; build the
        # user message with state-derived data via the dedicated helper.
        # We can't reuse _invoke_llm_json because the user template needs
        # selected_units (a list of bullets built from candidates), not a
        # flat format-string substitution.
        prompt_data = load_prompt_effective(COMMIT_PROMPT)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = self._build_commit_user_prompt(prompt_data["user_prompt_template"], state)

        state.commit_started_at = _now_iso()
        response = await self._router.execute(
            agent_name="three_b",
            task_name="commit",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        raw = _parse_json_or_raise(response.get("content", ""), "commit")
        state.committed_concept = {
            "one_line": raw.get("one_line", "") or "",
            "expanded": raw.get("expanded", "") or "",
            "core_tension": raw.get("core_tension", "") or "",
            "tone": raw.get("tone", "") or "",
            "logline": raw.get("logline", "") or "",
            "edited_by_user": False,
        }
        # Novelty scoring (sync; commit is async only because of the LLM call).
        evaluator = self._build_novelty_evaluator(project_id)
        novelty = evaluator.evaluate(state.committed_concept)
        state.novelty_scores = {
            "composite": novelty.total,
            "market_saturation": novelty.market_saturation_score,
            "trope_similarity": novelty.trope_similarity_score,
            "contradiction_depth": novelty.contradiction_depth_score,
            "discussion_potential": novelty.discussion_potential_score,
            "grade": novelty.grade,
        }
        state.commit_completed_at = _now_iso()
        atomic_write_state(project_id, state)
        return {"committed_concept": state.committed_concept, "novelty_scores": state.novelty_scores}

    async def edit_committed_concept(
        self, project_id: str, edited_fields: dict
    ) -> dict:
        """用户编辑层:接受部分字段编辑,保留未编辑字段,设置 edited_by_user=True。"""
        state = load_state(project_id)
        if state is None or state.committed_concept is None:
            raise ValueError("committed_concept 未提交,无法编辑")
        unknown = set(edited_fields.keys()) - ALLOWED_EDIT_FIELDS
        if unknown:
            raise ValueError(f"未知字段: {unknown}")
        for k, v in edited_fields.items():
            state.committed_concept[k] = v
        state.committed_concept["edited_by_user"] = True
        atomic_write_state(project_id, state)
        return {"committed_concept": state.committed_concept}

    async def advance(self, project_id: str) -> dict:
        """写盘:若 committed_concept 为 null 先 commit;否则直接写。"""
        state = load_state(project_id)
        if state is None:
            raise ValueError(f"项目 {project_id} 无 state")
        if state.committed_concept is None:
            await self.commit(project_id)
            state = load_state(project_id)
        # 写 concept_and_dna.json
        concept = {k: v for k, v in state.committed_concept.items() if k != "edited_by_user"}
        dna_payload = {
            "concept": concept,
            "story_dna": {
                "core_contradiction": {"statement": state.committed_concept["core_tension"]},
                "value_stack": [],
                "tone": state.committed_concept["tone"],
            },
            "novelty_scores": state.novelty_scores,
            "source": "creative_divergence",
            "three_b_snapshot": {
                "schema_version": 2,
                "committed_at": state.commit_completed_at or _now_iso(),
            },
        }
        dna_path = Path(settings.projects_dir) / project_id / "concept_and_dna.json"
        dna_path.parent.mkdir(parents=True, exist_ok=True)
        dna_path.write_text(json.dumps(dna_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        # 写 creative_divergence.json(compat)
        intent = state.raw_intent
        div_payload = {
            "prompt": (intent.prompt if intent else "")[:1700],
            "variants": [],
            "selected_id": None,
            "selected_at": _now_iso(),
            "source": "creative_divergence",
        }
        div_path = Path(settings.projects_dir) / project_id / "creative_divergence.json"
        div_path.write_text(json.dumps(div_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        return {"written": True, "committed_at": dna_payload["three_b_snapshot"]["committed_at"]}

    def _build_commit_user_prompt(
        self, user_prompt_template: str, state: ThreeBState
    ) -> str:
        """Format the user prompt for `commit`. Bullets each unit; marks un-diverged
        units as `[unit <id> 未参与]` so the LLM can ignore them when synthesizing
        the 5-field concept (per three_b_commit.yaml §合成原则)."""
        assert state.raw_intent is not None  # guarded in commit()
        selected_units: list[str] = []
        for d in state.dimensions:
            for u in d.units:
                cand = next(
                    (
                        c
                        for c in d.candidates
                        if c.unit_id == u.id and c.selection_rank == 0
                    ),
                    None,
                )
                if cand:
                    selected_units.append(
                        f"- [{d.dimension.value}] {u.unit_name}: {cand.description}\n"
                        f"  连锁推演: {cand.chain_reaction}"
                    )
                else:
                    selected_units.append(
                        f"- [{d.dimension.value}] {u.unit_name}: [unit {u.id} 未参与]"
                    )
        return user_prompt_template.format(
            prompt=state.raw_intent.prompt,
            genre_primary=state.raw_intent.genre_primary,
            causal_map=state.causal_map,
            top_level_summary=state.top_level_summary,
            selected_units="\n".join(selected_units),
        )