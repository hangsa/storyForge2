"""创意发散专用引擎(2026-09-19 简化版:仅保留 S1 拆解 + S2 追问)。

砍掉 S3 自适应发散与 S4 LLM 合成两阶段后,`/commit` 改为零 LLM 的 deterministic
拼装(`synthesize_concept_and_dna`),把 b3_state 内的 raw_intent + 5 维度
top_level_summary 写入 `concept_and_dna.json`,供下游 STAGE2 STAGE4 消费。

两阶段(拆解 + 追问):
  - decompose():                  Stage 1→2 第一性拆解,1 次 LLM 调用产出 5 维度 + insight + causal_map + summary
  - follow_up_unit():             Stage 2 单元追问,原地替换 description
  - synthesize_concept_and_dna(): 提交 → 写 concept_and_dna.json + creative_divergence.json(零 LLM)
  - mark_committed():             把 state 标记 committed 并落盘

State 文件: <project>/creative_os/b3_state.json, schema_version=3。
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from backend.config import settings
from backend.services.dimension_labels import Dimension  # noqa: F401  (re-exported)
from backend.creative_os.creative_dimensions import DimensionEntry  # noqa: F401  (re-exported)
from backend.utils.file_manager import FileManager
from backend.services.prompt_override_store import (
    PromptOverrideStore,
    load_prompt_effective,
)
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
from backend.agents._injection_helpers import _build_user_modifications_block
from backend.conductor.state_machine import StageStateMachine, Stage


def _file_manager() -> FileManager:
    """Return a FileManager resolved against the current settings.projects_dir."""
    return FileManager(settings.projects_dir)


logger = logging.getLogger(__name__)


# Strip reasoning-model <think>...</think> blocks from LLM output before we
# parse it / save it as a prompt override. Reasoning models (MiniMax-M3 etc.)
# wrap chain-of-thought inside the think block and put the actual answer
# AFTER `</think>` — without this strip, the JSON parser fails because the
# think block + `###TASK_COMPLETED###` etc. get treated as the response body.
# Pattern mirrors `novelty_evaluator._THINK_BLOCK_RE`.
_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_think_block(text: str) -> str:
    """Drop reasoning-model think blocks; return the residual trimmed text.

    Handles the common closed form (`<think>...</think>`). For the rarer
    truncated/unterminated case (model emits `<think>` but never closes it),
    we conservatively drop only when no JSON-like payload survives — that
    way we don't accidentally eat a real answer that just happens to be
    preceded by an unclosed think opener.
    """
    if not text:
        return ""
    cleaned = _THINK_BLOCK_RE.sub("", text).strip()
    return cleaned


def _safe_format(template: str, **kwargs: object) -> str:
    """Format `template` with kwargs, surviving literal `{...}` from
    LLM-generated overrides.

    Background: meta_decompose writes a per-project override for
    `firstness_decompose.system_prompt` whose content includes a canonical
    JSON template (literal `{...}` for the LLM that runs /decompose to see).
    Plain `.format(negative_constraints="")` cannot handle literal `{...}`
    because Python's formatter interprets every `{X}` as a placeholder
    start, raising `KeyError` on the first `{` that doesn't name a kwarg
    (e.g. `{` in `{"dimensions": [...]}`) — surfacing as
    `503 DECOMPOSE_FAILED: '\\n  "dimensions"'` (proj_4e6f888f 2026-09-13
    17:32).

    Strategy: walk the template once with balanced-brace tracking,
    treating `{{` / `}}` as YAML-escape units. For each balanced `{X}`
    group:
      - if X names a kwarg → emit `str(kwargs[X])`
      - else → emit `{` + recursively-rendered X + `}` (literal preserved)
    Lone `{` / `}` (no matching pair) passes through unchanged.

    No `.format()` call is needed — substitution is done manually, so
    balanced literal groups never get re-interpreted.
    """
    out: list[str] = []
    i = 0
    n = len(template)
    while i < n:
        # YAML-escaped braces: `{{` / `}}` round-trip to a single
        # `{` / `}` in the output.
        if i + 1 < n and template[i] == "{" and template[i + 1] == "{":
            out.append("{")
            i += 2
            continue
        if i + 1 < n and template[i] == "}" and template[i + 1] == "}":
            out.append("}")
            i += 2
            continue
        ch = template[i]
        if ch != "{":
            out.append(ch)
            i += 1
            continue
        # Walk a balanced `{X}` group, treating `{{` / `}}` inside as units.
        depth = 1
        j = i + 1
        while j < n and depth > 0:
            tj = template[j]
            if tj == "{" and j + 1 < n and template[j + 1] == "{":
                j += 2
                continue
            if tj == "}" and j + 1 < n and template[j + 1] == "}":
                j += 2
                continue
            if tj == "{":
                depth += 1
            elif tj == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth != 0:
            # Unmatched `{` — pass through literally.
            out.append("{")
            i += 1
            continue
        inner = template[i + 1 : j]
        if inner in kwargs:
            out.append(str(kwargs[inner]))
        else:
            # Literal balanced group — recurse so nested braces are
            # also rendered correctly (a literal `{X}` may itself
            # contain a literal `{Y}`).
            out.append("{")
            out.append(_safe_format(inner, **kwargs))
            out.append("}")
        i = j + 1
    return "".join(out)


STATE_FILE = "b3_state.json"
STATE_DIR = "creative_os"

OPERATORS = ("distort", "break", "blend", "chain")
ADAPTIVE_DIVERGE_PROMPT = "adaptive_diverge"
DECOMPOSE_PROMPT = "firstness_decompose"
META_DECOMPOSE_PROMPT = "meta_decompose"
FOLLOW_UP_PROMPT = "follow_up"

# 自适应追问模式的方法论段由 adaptive_diverge.yaml 的 `methodology_block`
# 字段提供(2026-09-20 改造:以前是下面的 ADAPTIVE_FOLLOW_UP_OPERATOR_INSTRUCTIONS
# 内联常量)。follow_up_unit 通过 load_prompt_effective 读取,让用户可通过
# Prompt Plaza / global overrides 调整自适应追问方法论。
#
# 与 adaptive_diverge.yaml 自己的 system_prompt 区分:那是 S3 死路径的 spec 文档
# (产出 2-3 个候选),不参与运行时调用;methodology_block 才是被注入到 follow_up
# 的 {operator_instructions} 占位的实际片段。

DimensionStatus = Literal["pending", "decomposed"]

@dataclass
class RawIntent:
    prompt: str
    genre_primary: str
    tone: str = ""
    style: str = ""


@dataclass
class Unit:
    """拆解产出的基本单元。"""
    id: str                           # "unit_<6hex>"
    dimension: Dimension
    unit_name: str                    # LLM 给的网文子域标签
    description: str
    follow_up_count: int = 0
    is_irreducible: bool = False
    # 追问使用的算子(main/aux)与连锁推演。仅在 operator=adaptive 追问后
    # 填入;无算子模式追问后保持 None。_rebuild_dimension 用 Unit(**u)
    # 散开,旧 state 文件缺这些键时因默认值不会炸。
    main_operator: Optional[str] = None
    aux_operator: Optional[str] = None
    chain_reaction: Optional[str] = None


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
class B3State:
    """schema_version=3 的全局状态(2026-09-19:砍掉 S3/S4 字段)。

    较 schema_version=2 移除:diverge_started_at / diverge_completed_at /
    commit_started_at / commit_completed_at / committed_concept /
    novelty_scores。这些字段在旧 state 文件中可能仍然存在 — `load_state`
    会用 dataclass fields 名称做白名单过滤,丢弃多余键。
    """
    schema_version: int = 3
    project_id: str = ""
    raw_intent: Optional[RawIntent] = None

    # Stage 2 拆解
    decompose_started_at: Optional[str] = None
    decompose_completed_at: Optional[str] = None
    causal_map: str = ""
    top_level_summary: str = ""
    dimensions: list[DimensionDecomposition] = field(default_factory=list)

    # 2026-09-19 提交时写入 — 标记「已落盘 concept_and_dna」,前端可用作
    # step 1 完成判定。schema v3 之前的 state 文件无此字段,默认 None。
    committed_at: Optional[str] = None


def _state_path(project_id: str) -> Path:
    return (
        Path(settings.projects_dir)
        / project_id
        / STATE_DIR
        / STATE_FILE
    )


def _resolve_state_path(project_id: str) -> Path:
    """Resolve the state file path, preferring the new `b3_state.json` and
    falling back to the legacy `three_b_state.json` so existing projects
    continue to load after the rename.
    """
    new_path = _state_path(project_id)
    if new_path.exists():
        return new_path
    legacy = new_path.with_name("three_b_state.json")
    return legacy if legacy.exists() else new_path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


def _parse_json_or_raise(raw_text: str, op: str) -> dict:
    """Parse LLM JSON output; raise engine-friendly ValueError on failure.

    Uses `parse_json_text` so we accept the same shapes BaseAgent / Reviewer
    do: bare JSON, JSON wrapped in a markdown code fence (```json ... ``` or
    bare ``` ... ```), or JSON with leading / trailing prose. This aligns 3B
    with the rest of the codebase — without it, deepseek's occasional mode
    leak (```json fence even with response_format=json_object) bubbles up
    as "Expecting ',' delimiter: line N column M" to the user. Observed on
    proj_47738f64 firstness_decompose, 2026-09-11.
    """
    from backend.utils.json_parser import parse_json_text

    # Defense-in-depth: strip reasoning-model think blocks before parsing.
    # `invoke_meta_llm` strips at write time, but a polluted override can
    # still reach here via: (a) global firstness_decompose override that
    # predates the strip; (b) a hand-edited system_prompt in Prompt Plaza
    # that landed from a previous polluted run before this fix; (c) any
    # other 3B LLM call (commit / follow_up) when the model thinks first.
    cleaned = _strip_think_block(raw_text)
    data = parse_json_text(cleaned)
    if data is None:
        raise ValueError(f"{op}: LLM 返回非 JSON: 无法解析 LLM 输出")
    if not isinstance(data, dict):
        raise ValueError(f"{op}: LLM 输出不是 dict")
    return data


def atomic_write_state(project_id: str, state: B3State) -> None:
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


def load_state(project_id: str) -> Optional[B3State]:
    """Load B3State; returns None if state file missing.

    Round-trip dataclasses for Unit / UnitCandidate / DimensionDecomposition / RawIntent.

    Schema tolerance:
      - raw_intent may have been written by an older version that included
        `genre_secondary` and lacked `tone`/`style`. Strip the legacy field
        and apply defaults so an old disk file still loads instead of
        crashing HYDRATE with TypeError.
      - top-level B3State may include legacy fields from schema_version=2
        (diverge_started_at / diverge_completed_at / commit_started_at /
        commit_completed_at / committed_concept / novelty_scores) which
        no longer exist on the dataclass after the 2026-09-19 S3/S4 cut.
        Filter raw keys against `fields(B3State)` before splat-constructing
        so old files load without TypeError instead of forcing the user to
        wipe state and re-decompose.
    """
    path = _resolve_state_path(project_id)
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("raw_intent"):
        ri = dict(raw["raw_intent"])
        ri.pop("genre_secondary", None)
        ri.setdefault("tone", "")
        ri.setdefault("style", "")
        raw["raw_intent"] = RawIntent(**ri)
    raw["dimensions"] = [
        _rebuild_dimension(d) for d in raw.get("dimensions", [])
    ]
    # Drop legacy top-level fields that no longer exist on B3State
    # (schema_version=2 → schema_version=3 cut on 2026-09-19: diverge_* /
    # commit_* / committed_concept / novelty_scores were removed).
    from dataclasses import fields as _dc_fields
    allowed = {f.name for f in _dc_fields(B3State)}
    raw = {k: v for k, v in raw.items() if k in allowed}
    return B3State(**raw)


def _rebuild_dimension(raw: dict) -> DimensionDecomposition:
    """Round-trip DimensionDecomposition from dict, including nested dataclasses."""
    return DimensionDecomposition(
        dimension=Dimension(raw["dimension"]),
        insight=raw.get("insight", ""),
        units=[Unit(**u) for u in raw.get("units", [])],
        candidates=[UnitCandidate(**c) for c in raw.get("candidates", [])],
        dimension_status=raw.get("dimension_status", "pending"),
    )


def migrate_state_on_load(project_id: str) -> Optional[B3State]:
    """Load state with v1→v2 migration: delete old file, return None.

    Spec §5: 直接删除 v1 文件,强制用户重走。无 banner,前端收 null 后弹一次性 toast。
    2026-09-19: schema 升到 v3(S3/S4 砍掉后),v2 / v3 都视为合法加载。
    """
    path = _resolve_state_path(project_id)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("b3 state unreadable, deleting: %s", project_id)
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return None
    if raw.get("schema_version") in (2, 3):
        return load_state(project_id)
    # v1 → v2: 直接删除
    try:
        path.unlink()
        logger.info("v1→v2 migration: deleted old b3_state.json for %s", project_id)
    except FileNotFoundError:
        pass
    return None


def _get_dimensions_store():
    """返回 lifespan / 测试 setup 注册的 CreativeDimensionsStore 单例。

    实现：模块级 lambda slot (`_dimensions_store_ref`)。
    注册：调用 `_register_dimensions_store(store)` 一次（在 lifespan 或
    测试 fixture 里）。未注册则返回 None → block 为空字符串（graceful fallback）。
    """
    ref = globals().get("_dimensions_store_ref")
    return ref() if ref else None


def _register_dimensions_store(store) -> None:
    """lifespan / 测试 setup 时调用一次。"""
    globals()["_dimensions_store_ref"] = lambda: store


def _resolve_dim_entry(store, kind: str, value: str):
    """按 id 或 name 解析 store entry;优先 id(name 在数据 corruption 修复后也可以命中)。

    raw_intent.genre_primary/tone/style 自 2026-09-14 起前端发送 name(用户可见标签)
    而非 store id;但历史 raw_intent 仍可能存旧 id(老项目未迁移 / 用户从未重开)。
    同时 id 优先是防御 — 万一后端别处还在按 id 写入,这里也能解析。
    """
    if not value:
        return None
    entry = store.get(kind, value)
    if entry is not None:
        return entry
    cat = getattr(store._get_catalog(), kind)  # type: ignore[attr-defined]
    for e in cat:
        if e.name == value:
            return e
    return None


def _build_dimension_block(raw_intent: Optional[RawIntent]) -> str:
    """根据 raw_intent 选中的 id 或 name，从 store 查 description，拼出「设定背景」块内容。

    没有 description 的维度行不出现；找不到的条目也不出现。
    """
    store = _get_dimensions_store()
    if raw_intent is None or store is None:
        return ""
    lines: list[str] = []
    for kind, label, value in [
        ("subject", "题材", raw_intent.genre_primary),
        ("tone",    "基调", raw_intent.tone),
        ("style",   "风格", raw_intent.style),
    ]:
        if not value:
            continue
        entry = _resolve_dim_entry(store, kind, value)
        if entry and entry.description and entry.description.strip():
            lines.append(f"{label}（{entry.name}）：{entry.description.strip()}")
    return "\n".join(lines)


def _maybe_inject_block(rendered_user_prompt: str, raw_intent: Optional[RawIntent]) -> str:
    """在已有 format 后的 user prompt 开头拼接「设定背景」块（block 为空则不变）。"""
    block = _build_dimension_block(raw_intent)
    if not block:
        return rendered_user_prompt
    return "【设定背景】\n" + block + "\n\n" + rendered_user_prompt


class B3Engine:
    """创意发散引擎(2026-09-19:仅保留拆解 + 追问 + 合成提交)。"""

    def __init__(
        self,
        model_router=None,
        novelty_evaluator=None,
        *,
        override_store: Optional[PromptOverrideStore] = None,
        global_override_store: Optional[GlobalPromptOverrideStore] = None,
    ) -> None:
        self._router = model_router
        self._novelty_evaluator = novelty_evaluator
        # v2 prompt override wiring: when these stores are injected, the
        # _invoke_llm_json* helpers route through `load_prompt_effective(name,
        # project_id, override_store, global_override_store)` so per-project
        # and global Prompt Plaza edits (e.g. `第一性拆解`) actually land in
        # the LLM call. Without these, `load_prompt_effective` silently
        # returns YAML defaults and override edits no-op at runtime.
        self._override_store = override_store
        self._global_override_store = global_override_store

    async def decompose(
        self, project_id: str, raw_intent: RawIntent, user_modifications: str = ""
    ) -> tuple[list[DimensionDecomposition], str, str]:
        """1 LLM call → (dimensions, causal_map, top_level_summary).

        `user_modifications` is the optional text the user enters in the S2
        regen dialog (round-tripped from the frontend RegenerateModal). When
        empty, the LLM receives an empty-string hint and ignores it. When
        non-empty, it's injected into the decompose prompt as a "user
        additional feedback" block — same pattern as concept_generation.yaml.

        On schema-invalid output (e.g. LLM returned parseable JSON but
        `dimensions: []`), the router's network-error retry does NOT help —
        the call succeeded at HTTP level, the JSON parsed, but the schema is
        degenerate. We retry the whole router.execute once with the same args
        to give the model another shot. Observed on proj_4e6f888f 2026-09-13
        where the MiniMax-M3 fallback (`deepseek-v4-flash`) returned
        `{"dimensions": []}` after the primary timed out three times.
        """
        started_at = _now_iso()
        last_schema_error: Optional[ValueError] = None
        for schema_attempt in range(2):
            t0 = time.perf_counter()
            response = await self._invoke_llm_json_with_block(
                DECOMPOSE_PROMPT, "decompose",
                raw_intent=raw_intent,
                project_id=project_id,
                prompt=raw_intent.prompt,
                genre_primary=raw_intent.genre_primary,
                tone=raw_intent.tone or "(无)",
                style=raw_intent.style or "(无)",
                user_modifications=_build_user_modifications_block(user_modifications),
            )
            elapsed = time.perf_counter() - t0
            usage = response.get("usage") or {}
            logger.info(
                "b3.decompose attempt=%d elapsed=%.2fs model=%s tokens_in=%d tokens_out=%d",
                schema_attempt + 1, elapsed, response.get("model", "?"),
                usage.get("input", 0), usage.get("output", 0),
            )
            raw_text = response.get("content", "")
            try:
                dims, causal_map, summary = self._parse_decompose_output(raw_text)
                break
            except ValueError as e:
                # Schema-invalid: log which model produced it (router.execute
                # echoes `model` in its response), then retry once. Network
                # errors / 503s are surfaced by the router itself, so this
                # only catches ValueError from _parse_decompose_output.
                last_schema_error = e
                logger.warning(
                    "decompose: schema-invalid response from model=%s (attempt %d): %s | raw[:500]=%r",
                    response.get("model", "?"), schema_attempt + 1, e, raw_text[:500],
                )
                if schema_attempt == 1:
                    raise
        else:
            # Defensive: loop completed without break (shouldn't happen since
            # the second attempt raises). Re-raise the captured error.
            raise last_schema_error or ValueError("decompose: schema retry exhausted")
        completed_at = _now_iso()
        state = load_state(project_id) or B3State(project_id=project_id)
        # 清空下游(decompose 自身的 dimensions 字段会被覆盖)
        state.dimensions = dims
        state.causal_map = causal_map
        state.top_level_summary = summary
        state.raw_intent = raw_intent
        state.decompose_started_at = started_at
        state.decompose_completed_at = completed_at
        # 重新拆解后,提交状态失效 — 强制用户重走 /commit。
        state.committed_at = None
        for d in state.dimensions:
            d.candidates = []
            d.dimension_status = "decomposed"
        atomic_write_state(project_id, state)
        return state.dimensions, state.causal_map, state.top_level_summary

    async def invoke_meta_llm(
        self, project_id: str, raw_intent: RawIntent
    ) -> str:
        """Generate a specialized firstness_decompose prompt from raw_intent.

        Plain-text output (json_mode=False). Writes the result to the
        project-level `firstness_decompose` override so subsequent
        /decompose calls see it via load_prompt_effective. Returns the
        raw LLM text for callers that want to surface it.

        Raises:
            ValueError: if the LLM returns empty content (mapped to 422).
            Exception: any other LLM failure (mapped to 503 by the route).
        """
        prompt_data = self._load_prompt(META_DECOMPOSE_PROMPT, project_id)
        system = _safe_format(prompt_data["system_prompt"], negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            tone=raw_intent.tone or "(无)",
            style=raw_intent.style or "(无)",
        )
        t0 = time.perf_counter()
        response = await self._router.execute(
            agent_name="b3",
            task_name="meta_decompose",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            json_mode=False,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 8192),
        )
        elapsed = time.perf_counter() - t0
        usage = response.get("usage") or {}
        logger.info(
            "b3.meta_decompose elapsed=%.2fs model=%s tokens_in=%d tokens_out=%d",
            elapsed, response.get("model", "?"),
            usage.get("input", 0), usage.get("output", 0),
        )
        # Strip reasoning-model think blocks BEFORE saving. Without this the
        # override gets polluted with `<think>...</think>` English self-review
        # (proj_4e6f888f 2026-09-13) and the next /decompose call loads the
        # polluted prompt as its system_prompt → LLM responds inside another
        # think block → /decompose 422s with "无法解析 LLM 输出".
        text = _strip_think_block(response.get("content") or "")
        if not text:
            raise ValueError("meta_decompose: LLM 返回空文本")

        # set_override 内部做 3 件事:
        #   1. 读取项目现有 overrides,merge 现有字段(保留 user_prompt_template 等其它覆盖)
        #   2. _pruned_override 只保留与 YAML 不同的字段(LLM 偶尔返回等于 YAML 的文本时会被裁掉,无副作用)
        #   3. 原子写回 prompt_overrides.json
        self._override_store.set_override(
            project_id, "firstness_decompose", {"system_prompt": text}
        )
        return text

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

    def _build_prompt_messages(
        self,
        prompt_name: str,
        project_id: Optional[str] = None,
        system_fmt: Optional[dict] = None,
        **fmt,
    ) -> tuple[str, str]:
        """Load + format a v2 prompt. Returns (system, user) messages.

        Negative constraints are always substituted with empty string.
        Other system-level placeholders come in via `system_fmt` (e.g.
        `{"operator_instructions": "..."}` for follow-up adaptive mode).
        User-level placeholders are passed through `**fmt`.
        """
        prompt_data = self._load_prompt(prompt_name, project_id)
        sys_kwargs: dict[str, object] = {"negative_constraints": ""}
        if system_fmt:
            sys_kwargs.update(system_fmt)
        system = _safe_format(prompt_data["system_prompt"], **sys_kwargs)
        user = prompt_data["user_prompt_template"].format(**fmt)
        return system, user

    def _load_prompt(self, prompt_name: str, project_id: Optional[str]) -> dict:
        """3-tier merge: YAML → global override → project override.

        Wraps `load_prompt_effective` so the engine's injected stores
        actually take effect (caller has project_id; the helper skips layers
        that were never wired in).
        """
        return load_prompt_effective(
            prompt_name,
            project_id=project_id,
            override_store=self._override_store,
            global_override_store=self._global_override_store,
        )

    async def _invoke_llm_json(
        self,
        prompt_name: str,
        task_name: str,
        project_id: Optional[str] = None,
        system_fmt: Optional[dict] = None,
        **fmt,
    ) -> dict:
        """Call the LLM with standard 3B envelope (json_mode, b3 agent).

        `system_fmt` is forwarded to `_build_prompt_messages` for system-level
        placeholders (e.g. `{operator_instructions}` in follow_up.yaml when
        operator=adaptive). All other `**fmt` are user-level substitutions.

        Returns the raw response dict from router.execute (caller is responsible
        for extracting/parsing content).
        """
        system, user = self._build_prompt_messages(
            prompt_name, project_id=project_id, system_fmt=system_fmt, **fmt
        )
        prompt_data = self._load_prompt(prompt_name, project_id)
        return await self._router.execute(
            agent_name="b3",
            task_name=task_name,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )

    async def _invoke_llm_json_with_block(
        self,
        prompt_name: str,
        task_name: str,
        *,
        raw_intent: Optional[RawIntent] = None,
        project_id: Optional[str] = None,
        **fmt,
    ) -> dict:
        """与 _invoke_llm_json 相同，但额外在 user 消息前注入「设定背景」块。"""
        prompt_data = self._load_prompt(prompt_name, project_id)
        system = _safe_format(prompt_data["system_prompt"], negative_constraints="")
        user = prompt_data["user_prompt_template"].format(**fmt)
        user = _maybe_inject_block(user, raw_intent)
        return await self._router.execute(
            agent_name="b3",
            task_name=task_name,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )

    async def follow_up_unit(
        self,
        project_id: str,
        unit_id: str,
        user_question: Optional[str],
        operator: str = "none",
    ) -> Unit:
        """LLM 原地替换 description,记录 follow_up_count。

        operator:
          - "none" (默认) — 走追问式深化,无算子语义
          - "adaptive" — 复用 adaptive_diverge 的扫描-路由-主辅算子方法论,
            结合用户修改意见综合生成。LLM 输出的 main_operator / aux_operator /
            chain_reaction 会被持久化到 Unit 上,前端在 unit_name 后展示。
        """
        state = load_state(project_id)
        if state is None:
            raise ValueError(f"项目 {project_id} 未拆解")
        target = self._find_unit(state, unit_id)
        if target is None:
            raise ValueError(f"unit {unit_id} 不存在")
        if target.is_irreducible:
            raise ValueError(f"unit {unit_id} 已不可约化")

        is_adaptive = operator == "adaptive"
        # 自适应模式填方法论段(从 adaptive_diverge.yaml 加载,支持 Plaza / global /
        # project 三层 override),无算子模式填空字符串(prompt 末尾会留下一个空行,
        # 但不会影响 LLM 理解 — 视觉上仅一点点冗余,可接受)。
        if is_adaptive:
            adaptive_prompt = load_prompt_effective(
                ADAPTIVE_DIVERGE_PROMPT,
                project_id=project_id,
                override_store=self._override_store,
                global_override_store=self._global_override_store,
            )
            operator_instructions = (adaptive_prompt.get("methodology_block") or "").strip()
        else:
            operator_instructions = ""
        operator_label = (
            "自适应(自动匹配主+辅算子,结合用户修改意见)"
            if is_adaptive
            else "无算子(默认追问式深化)"
        )
        # 自适应模式允许 user_question 留空(纯算子驱动);
        # 无算子模式也保留原"无明确问题"占位以兼容旧 prompt 行为。
        if is_adaptive:
            user_modifications_block = (
                f"用户修改意见: {user_question}"
                if user_question
                else "用户修改意见: (用户未提供修改意见,纯算子驱动)"
            )
        else:
            user_modifications_block = (
                f"用户追问: {user_question}"
                if user_question
                else "用户追问: (无明确问题,请基于该单元当前描述做一次深化)"
            )

        response = await self._invoke_llm_json(
            FOLLOW_UP_PROMPT, "follow_up",
            project_id=project_id,
            system_fmt={"operator_instructions": operator_instructions},
            unit_name=target.unit_name,
            description=target.description,
            user_question=user_question or "(无明确问题,请基于该单元当前描述做一次深化)",
            operator_label=operator_label,
            user_modifications_block=user_modifications_block,
        )
        raw = _parse_json_or_raise(response.get("content", ""), "follow_up_unit")
        target.description = raw.get("description", target.description) or target.description
        if raw.get("unit_name"):
            target.unit_name = raw["unit_name"]
        if raw.get("is_irreducible") is True:
            target.is_irreducible = True
        # 自适应模式持久化算子 + 连锁推演;无算子模式强制 None,防止 LLM 残留字段污染。
        if is_adaptive:
            mo = raw.get("main_operator")
            target.main_operator = mo if mo in OPERATORS else None
            ao = raw.get("aux_operator")
            target.aux_operator = ao if ao in OPERATORS else None
            cr = raw.get("chain_reaction")
            target.chain_reaction = cr.strip() if isinstance(cr, str) and cr.strip() else None
        else:
            target.main_operator = None
            target.aux_operator = None
            target.chain_reaction = None
        target.follow_up_count += 1
        atomic_write_state(project_id, state)
        return target

    def _find_unit(self, state: B3State, unit_id: str) -> Optional[Unit]:
        for d in state.dimensions:
            for u in d.units:
                if u.id == unit_id:
                    return u
        return None

    async def synthesize_concept_and_dna(self, project_id: str) -> dict:
        """Deterministic 拼装:把 b3_state 的 raw_intent + 5 维度 top_level_summary
        写入 `concept_and_dna.json`。零 LLM 调用。

        字段映射(下游 STAGE2~4 消费者依赖以下 4 个扁平字段):
          - concept.premise     = raw_intent.prompt[:1700]   ← STAGE4 writer 主读
          - concept.title       = project.json.title(用户创建项目时起的书名)
                                    缺失时 fallback 到 prompt[:80]          ← UI / 项目列表展示
          - concept.tone        = raw_intent.tone
          - concept.theme       = ""                         ← STAGE4 不读,留空不报错
          - story_dna.core_contradiction.statement = top_level_summary
          - story_dna.tone      = raw_intent.tone
          - story_dna.value_stack = []
          - novelty_scores      = None                       ← 原 S4 novelty 跑分,世界观众测不需要
          - source              = "creative_divergence"
          - b3_snapshot.schema_version = 3

        同时写 `creative_divergence.json` compat(供 wizardSidebar 的
        `getCreativeDivergence` 用 `selected_at` 判定 step 1 完成)。

        返回 dict 包含 `{concept_and_dna, creative_divergence, b3_state}` —
        前端 commit 提交成功后无需再调 GET,直接拿来更新内存。

        阶段推进:commit 成功后调用 StageStateMachine.advance(STAGE2),
        否则 WorldStep 自动触发的 /stage2/generate-world 会因前置检查失败而 400。
        旧 Stage1Page 通过独立「enter world+character」按钮调 api.advance("STAGE2")
        完成这一步;合并到 /commit 后,这里把职责搬回来。
        """
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError(f"项目 {project_id} 未拆解")
        if not state.dimensions:
            raise ValueError("无 5 维度拆解结果,无法合成 concept_and_dna")

        prompt_text = state.raw_intent.prompt or ""
        committed_at = _now_iso()

        # 读用户的书名 — 创建项目时 project.json.title 是显式身份,
        # 不应该被 raw prompt 截断默默覆盖(bookshelf 展示契约)。
        # 缺失(老项目没 title 字段)时 fallback 到 prompt[:80]。
        project_path = Path(settings.projects_dir) / project_id / "project.json"
        project_doc: dict = {}
        if project_path.exists():
            try:
                project_doc = json.loads(project_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                project_doc = {}
        user_title = (project_doc.get("title") or "").strip()
        concept_title = user_title if user_title else prompt_text[:80]

        concept = {
            "title": concept_title,
            "premise": prompt_text[:1700],
            "tone": state.raw_intent.tone or "",
            "theme": "",
            # 注:STAGE2~4 消费者只读上面 4 个字段。下游若需要 concept.genre /
            # target_audience / style_template,会从 project.json 拿,不在此处
            # 冗余存储。
        }
        story_dna = {
            "core_contradiction": {
                "statement": state.top_level_summary or "",
                "side_a": "",
                "side_b": "",
            },
            "value_stack": [],
            "tone": state.raw_intent.tone or "",
        }
        dna_payload = {
            "concept": concept,
            "story_dna": story_dna,
            "novelty_scores": None,
            "source": "creative_divergence",
            "b3_snapshot": {
                "schema_version": 3,
                "committed_at": committed_at,
            },
        }

        # 写盘
        dna_path = Path(settings.projects_dir) / project_id / "concept_and_dna.json"
        dna_path.parent.mkdir(parents=True, exist_ok=True)
        dna_path.write_text(json.dumps(dna_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        div_payload = {
            "prompt": prompt_text[:1700],
            "variants": [],
            "selected_id": None,
            "selected_at": committed_at,
            "source": "creative_divergence",
        }
        div_path = Path(settings.projects_dir) / project_id / "creative_divergence.json"
        div_path.write_text(json.dumps(div_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        # 标记 state.committed_at — 让前端 HYDRATE 时知道 step 1 已完成
        state.committed_at = committed_at
        atomic_write_state(project_id, state)

        # 推进 STAGE1 → STAGE2 — WorldStep 的 /stage2/generate-world 会校验前置。
        # synthesize 成功意味着 concept_and_dna 已落盘,STAGE2 precondition 满足,
        # transition_check 必然 allowed,但保留结果以便调用方/测试断言。
        advance_result = StageStateMachine(
            Path(settings.projects_dir)
        ).advance(project_id, Stage.STAGE2)
        if not advance_result.allowed:
            # 不让「阶段推进失败」静默吞掉 — 上层(/commit 路由)会拿到 503。
            raise RuntimeError(
                f"commit 阶段推进失败: {advance_result.message}"
            )

        return {
            "concept_and_dna": dna_payload,
            "creative_divergence": div_payload,
            "b3_state": asdict(state),
            "committed_at": committed_at,
        }

    def mark_committed(self, project_id: str) -> None:
        """轻量版提交标记:仅写 state.committed_at,不写 concept_and_dna.json。

        用于:重走拆解后再 commit 时,告知前端"step 1 仍视为已完成"。
        当前 /commit 路径在 `synthesize_concept_and_dna` 内部已写,
        此 helper 保留作为未来"只标记不写盘"场景的接口,本轮未实际调用。
        """
        state = load_state(project_id)
        if state is None:
            return
        state.committed_at = _now_iso()
        atomic_write_state(project_id, state)