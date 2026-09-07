# Creative Decomposition + Adaptive Divergence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-KILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Wizard 的「创意发散」步骤为 4 阶段流程(输入 / 拆解 / 自适应发散 / 提交),按 `docs/design/创意分解.md` 做第一性拆解(5 维度 × N units + insight + causal_map + top_level_summary),按 `docs/design/自适应发散引擎.md` 在 unit 级做扫描+路由+主辅算子+连锁推演。

**Architecture:** 后端 `ThreeBEngine` 重写 dataclass(schema_version=2)+ 8 个方法(decompose / follow_up_unit / diverge / regenerate_unit / select_unit_candidate / commit / edit_committed_concept / advance),状态写盘走 v1 已有的 `atomic_write_state`(`.tmp + os.replace`)。v1→v2 迁移直接删除旧文件 + 返回 None。前端 `useThreeBDivergence` reducer 重写,新增 `JUMP_TO_STAGE` / `REQUEST_NEXT` / `CONFIRM_NEXT` / `CANCEL_NEXT` actions 实现「跳回非破坏 + 下一步清空下游」语义。

**Tech Stack:** Python 3.11+ FastAPI + Pydantic · pytest · React 18 + Vite + Tailwind · TypeScript · vitest + @testing-library/react

---

## Spec 偏离说明

实施时以下三点与 `2026-09-06-creative-decomposition-and-adaptive-engine-design.md` 不一致(spec 草稿时未完全展开):

1. **§6.1 advance 端点 vs 路由串接**:spec 说 `/advance` 内部组合 `/commit`,但路由层用 FastAPI 依赖注入,实际可以让 `advance` route 在 committed_concept 为 null 时直接调 `engine.commit()`,无需额外 HTTP 跳转。
2. **§6.4 decompose/diverge 写盘前清空下游**:实际实现是 engine 方法开头先 `state.dimensions = []`(本步自身重写) + `state.committed_concept = None` + 清对应 *_completed_at,不需要再单独走"清空"接口。
3. **§7.2 reducer actions**:为了避免 reducer 过于庞大,「REQUEST_NEXT 检查下游数据」逻辑放在 selector / hook 层而非 reducer。reducer 只接 4 类 actions: JUMP_TO_STAGE / CONFIRM_NEXT(target stage 参数) / 原始阶段 actions(decompose/diverge/commit/advance) / RESET。具体的"是否需要 confirm"由调用方在 dispatch 前判断。

---

## File Structure

### Backend

| 文件 | 状态 | 职责 |
|---|---|---|
| `backend/services/dimension_labels.py` | 新建 | 5 维度中英映射(前后端共用) |
| `backend/creative_os/three_b_engine.py` | 重写 | v2 dataclass + 8 engine 方法 + atomic_write + migrate |
| `backend/api/three_b_routes.py` | 重写 | 10 端点(state/get, state/delete, decompose, follow-up, diverge, regenerate-unit, select-unit, commit, edit-concept, advance) |
| `backend/prompts/creative/three_b_decompose.yaml` | 新建 | 5 维度第一性拆解 prompt |
| `backend/prompts/creative/three_b_follow_up.yaml` | 新建 | 单单元原地追问 prompt |
| `backend/prompts/creative/three_b_adaptive_diverge.yaml` | 新建 | 扫描+路由+4 算子+chain_reaction 综合 prompt |
| `backend/prompts/creative/three_b_commit.yaml` | 重写 | 合成 prompt(输入加 causal_map + summary) |
| `backend/prompts/creative/three_b_breaking.yaml` | **删除** | 旧 3B 算子 |
| `backend/prompts/creative/three_b_bending.yaml` | **删除** | 旧 3B 算子 |
| `backend/prompts/creative/three_b_blending.yaml` | **删除** | 旧 3B 算子 |

### Frontend

| 文件 | 状态 | 职责 |
|---|---|---|
| `frontend/src/components/wizard/divergence_v2/types.ts` | 重写 | Dimension / Unit / UnitCandidate / DimensionDecomposition / CommittedConcept / ThreeBState(snake_case 转换在 API 边界) |
| `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` | 保留(几乎不改) | prompt + genres 输入 |
| `frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx` | 新建 | 5 维度 + insight + causal_map + 追问 |
| `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` | 新建 | per-unit 自适应发散 + chain_reaction |
| `frontend/src/components/wizard/divergence_v2/S4CommitStep.tsx` | 新建 | 5 字段 + 编辑 + 重新生成 + 下一步 advance |
| `frontend/src/components/wizard/divergence_v2/ConfirmNextDialog.tsx` | 新建 | 二次确认 dialog(通用) |
| `frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts` | 重写 | reducer + selectors + hooks |
| `frontend/src/components/wizard/divergence_v2/StepIndicator.tsx` | 改 | 4 阶段 + onStageClick 调 JUMP_TO_STAGE |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | 重写 | orchestrator,适配 onAdvanceSuccess 通知 wizard step 1 |
| `frontend/src/api/client.ts` | 改 | 10 个 API 方法(替代 6 个) |
| `frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx` | **删除** | 旧 v1 |
| `frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx` | **删除** | 旧 v1 |

### Tests

| 文件 | 状态 | 覆盖 |
|---|---|---|
| `tests/test_creative_os/test_three_b_engine.py` | 重写 | 8 方法 happy + 异常 + asyncio.gather 降级 + commit ≥3 fail 拒绝 |
| `tests/test_creative_os/test_three_b_migration.py` | 新建 | v1→v2 两场景(无文件 + 有文件) |
| `tests/test_creative_os/test_three_b_diverge_unit.py` | 新建 | 自适应发散 prompt 结构 + 4 算子 + chain_reaction |
| `backend/tests/test_api/test_three_b_routes.py` | 重写 | 10 端点契约 + 错误码 |
| `backend/tests/test_three_b_yaml.py` | 改 | 4 YAML 校验(decompose / follow_up / adaptive_diverge / commit) |
| `frontend/src/test/wizard/divergence_v2/S2DecomposeStep.test.tsx` | 新建 | 5 维度渲染 + insight + 追问 + irreducible |
| `frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx` | 新建 | 候选 radio + chain_reaction + 失败 unit + 重生成 |
| `frontend/src/test/wizard/divergence_v2/S4CommitStep.test.tsx` | 新建 | 5 字段 + 编辑 + 重新生成 + advance |
| `frontend/src/test/wizard/divergence_v2/StepIndicator.test.tsx` | 改 | 4 阶段 jump 规则 |
| `frontend/src/test/wizard/divergence_v2/ConfirmNextDialog.test.tsx` | 新建 | 二次确认 dialog 流程 |
| `frontend/src/test/wizard/divergence_v2/useThreeBDivergence.test.ts` | 重写 | reducer 序列 + JUMP / REQUEST_NEXT / CONFIRM_NEXT |
| `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx` | 重写 | 4 阶段 orchestrator + v1 toast |

---

## 执行顺序修正(plan bug fix)

**原顺序 Tasks 3-9 → 10-12 不可执行**,因为:
- Task 3 (engine.decompose) 调用 `load_prompt_effective("three_b_decompose")` —— 该 YAML 在 Task 10 才创建
- Task 4-9 同理,所有 engine 方法都依赖 Prompt YAML

**修正后执行顺序:**
- Task 1 (dimension_labels) ✓ 已完成
- Task 2 (v2 schema) ✓ 已完成
- **Tasks 10, 11, 12 (Prompt YAMLs) 提前到 Tasks 3-9 之前**
- Tasks 3, 4, 5, 6, 7, 8, 9 (engine methods)
- Task 13 (API routes)
- Tasks 14-22 (frontend)
- Tasks 23, 24 (cleanup + verification)

执行期间 `tests/test_creative_os/test_three_b_engine.py` 在 Task 2 之后会有 7 个测试通过,Prompt YAML 完成后开始加 engine 方法测试。`backend/api/three_b_routes.py` 的 import 仍由 Task 2 的 shim 保活,直到 Task 13 重写。

---

## Task 1: dimension_labels 模块

**Files:**
- Create: `backend/services/dimension_labels.py`

- [ ] **Step 1: 写新文件**

```python
"""5 维度中英标签映射(前后端共用)。

后端在 ThreeBEngine + 错误信息中引用;前端在 StepIndicator / S2 header 中引用。
未来 i18n 时,本文件可改为读 i18n catalog。
"""

from __future__ import annotations

from enum import Enum


class Dimension(str, Enum):
    ONTOLOGY = "ontology"
    ENERGETICS = "energetics"
    POWER_STRUCTURE = "power_structure"
    PROTAGONIST_ENGINE = "protagonist_engine"
    NARRATIVE_PHYSICS = "narrative_physics"


DIMENSION_LABELS_ZH: dict[str, str] = {
    Dimension.ONTOLOGY.value: "世界构成",
    Dimension.ENERGETICS.value: "能量体系",
    Dimension.POWER_STRUCTURE.value: "社会控制",
    Dimension.PROTAGONIST_ENGINE.value: "主角机制",
    Dimension.NARRATIVE_PHYSICS.value: "叙事动力",
}

DIMENSION_LABELS_EN: dict[str, str] = {
    Dimension.ONTOLOGY.value: "Ontology",
    Dimension.ENERGETICS.value: "Energetics",
    Dimension.POWER_STRUCTURE.value: "Power Structure",
    Dimension.PROTAGONIST_ENGINE.value: "Protagonist Engine",
    Dimension.NARRATIVE_PHYSICS.value: "Narrative Physics",
}


def label_zh(dimension: str) -> str:
    return DIMENSION_LABELS_ZH.get(dimension, dimension)


def label_en(dimension: str) -> str:
    return DIMENSION_LABELS_EN.get(dimension, dimension)
```

- [ ] **Step 2: 写最小测试**

新建 `tests/test_services/test_dimension_labels.py`(目录若不存在则创建 `__init__.py`):

```python
from backend.services.dimension_labels import Dimension, label_zh, label_en


def test_labels_zh_returns_chinese_for_known_dimension():
    assert label_zh(Dimension.ONTOLOGY.value) == "世界构成"


def test_labels_zh_falls_back_to_value_for_unknown():
    assert label_zh("unknown_dim") == "unknown_dim"


def test_labels_en_returns_english_for_known_dimension():
    assert label_en(Dimension.ENERGETICS.value) == "Energetics"


def test_dimension_enum_values_match_labels_keys():
    assert set(DIMENSION_LABELS_ZH.keys()) == {d.value for d in Dimension}
```

(顶部加 `from backend.services.dimension_labels import DIMENSION_LABELS_ZH`。)

- [ ] **Step 3: 运行测试**

```bash
pytest tests/test_services/test_dimension_labels.py -v
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/services/dimension_labels.py tests/test_services/test_dimension_labels.py tests/test_services/__init__.py
git commit -m "feat(divergence): add dimension_labels module (5 维度中英映射)"
```

---

## Task 2: v2 schema dataclass

**Files:**
- Modify: `backend/creative_os/three_b_engine.py:1-180`(重写文件顶部)

- [ ] **Step 1: 替换文件顶部 imports + enums + 常量**

```python
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
```

(注意:`OPERATORS` 现在是 4 个自适应算子标识,跟 v1 的 `OPERATORS = ("breaking", "bending", "blending")` 不同。)

- [ ] **Step 2: 添加 RawIntent dataclass**

```python
@dataclass
class RawIntent:
    prompt: str
    genre_primary: str
    genre_secondary: Optional[str] = None
```

- [ ] **Step 3: 添加 Unit, UnitCandidate, DimensionDecomposition, ThreeBState dataclasses**

```python
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
```

- [ ] **Step 4: 替换 atomic_write_state / load_state / 新增 migrate_state_on_load**

```python
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
```

- [ ] **Step 5: 写测试覆盖 round-trip + migrate**

修改 `tests/test_creative_os/test_three_b_engine.py`(完整替换内容):

```python
"""ThreeBEngine v2 dataclass + 8 方法测试。"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.creative_os.three_b_engine import (
    Dimension,
    DimensionDecomposition,
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    Unit,
    UnitCandidate,
    atomic_write_state,
    load_state,
    migrate_state_on_load,
)
from backend.services.dimension_labels import Dimension as DimLabel


@pytest.fixture
def mock_router():
    """Router mock returning deterministic LLM responses."""
    router = AsyncMock()
    return router


# ---- dataclass round-trip ----

def test_state_round_trip(tmp_path, monkeypatch):
    """State writes + loads preserve all fields."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        causal_map="A → B",
        top_level_summary="一句话总结",
        dimensions=[
            DimensionDecomposition(
                dimension=DimLabel.ONTOLOGY,
                insight="本土 vs 异域",
                units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="能量接口")],
                candidates=[UnitCandidate(
                    id="cand_xyz", unit_id="unit_abc", unit_name="灵窍",
                    description="变异", chain_reaction="连锁变化",
                    main_operator="distort", aux_operator="break", selection_rank=0,
                )],
                dimension_status="diverged",
            )
        ],
        committed_concept={"one_line": "x"},
    )
    atomic_write_state("proj_test", state)
    loaded = load_state("proj_test")
    assert loaded is not None
    assert loaded.schema_version == 2
    assert loaded.causal_map == "A → B"
    assert loaded.dimensions[0].dimension == DimLabel.ONTOLOGY
    assert loaded.dimensions[0].units[0].unit_name == "灵窍"
    assert loaded.dimensions[0].candidates[0].main_operator == "distort"


def test_state_round_trip_handles_empty_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    loaded = load_state("proj_test")
    assert loaded.dimensions == []


def test_state_file_is_atomic_no_tmp_left(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    parent = tmp_path / "proj_test" / "creative_os"
    tmp_files = list(parent.glob(".three_b_state.json.*.tmp"))
    assert tmp_files == []


# ---- migrate v1→v2 ----

def test_migrate_deletes_v1_file(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state_path = tmp_path / "proj_test" / "creative_os" / "three_b_state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"schema_version": 1, "stage1_completed_at": "2026-09-01"}), encoding="utf-8")
    result = migrate_state_on_load("proj_test")
    assert result is None
    assert not state_path.exists()


def test_migrate_returns_none_when_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    assert migrate_state_on_load("proj_test") is None


def test_migrate_passes_v2_state_through(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test", schema_version=2)
    atomic_write_state("proj_test", state)
    result = migrate_state_on_load("proj_test")
    assert result is not None
    assert result.schema_version == 2


# (后续 Task 4-11 加 8 个 engine 方法的测试)
```

- [ ] **Step 6: 运行测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v
```

Expected: 6 passed(round-trip + empty + atomic + 3 migrate)。

- [ ] **Step 7: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): rewrite ThreeBState schema v2 + migrate v1→v2"
```

---

## Task 3: engine.decompose

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`(在 dataclass 后加 ThreeBEngine 类)

- [ ] **Step 1: 写失败测试**

在 `tests/test_creative_os/test_three_b_engine.py` 加:

```python
@pytest.mark.asyncio
async def test_decompose_returns_5_dimensions_with_insight_and_summary(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [
            {"dimension": "ontology", "insight": "本土 vs 异域天道",
             "units": [{"unit_name": "灵窍", "description": "能量接口"}, {"unit_name": "本源", "description": "底层储备"}]},
            {"dimension": "energetics", "insight": "能量调谐",
             "units": [{"unit_name": "修行", "description": "能量通道"}]},
            {"dimension": "power_structure", "insight": "三要素",
             "units": [{"unit_name": "资源控制", "description": "统治基础"}]},
            {"dimension": "protagonist_engine", "insight": "跨世界信息",
             "units": [{"unit_name": "穿越", "description": "跨世界迁移"}]},
            {"dimension": "narrative_physics", "insight": "底层冲突",
             "units": [{"unit_name": "核心矛盾", "description": "不可调和"}]},
        ],
        "causal_map": "ontology → energetics → power_structure → protagonist_engine → narrative_physics",
        "top_level_summary": "这是一个穿越者在双规则天道下的觉醒与变革故事。",
    }, ensure_ascii=False)}

    intent = RawIntent(prompt="修仙", genre_primary="修仙")
    result = await engine.decompose("proj_test", intent)
    dimensions, causal_map, summary = result
    assert len(dimensions) == 5
    assert dimensions[0].dimension == DimLabel.ONTOLOGY
    assert dimensions[0].insight == "本土 vs 异域天道"
    assert dimensions[0].units[0].unit_name == "灵窍"
    assert causal_map.startswith("ontology")
    assert "觉醒与变革" in summary

    # State should be persisted
    state = load_state("proj_test")
    assert state is not None
    assert state.dimensions[0].insight == "本土 vs 异域天道"
    assert state.causal_map.startswith("ontology")


@pytest.mark.asyncio
async def test_decompose_clears_downstream_state(tmp_path, monkeypatch, mock_router):
    """Re-decomposing should clear candidates + committed_concept from prior runs."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    # Seed prior state
    state = ThreeBState(
        project_id="proj_test",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="旧",
            units=[Unit(id="unit_old", dimension=DimLabel.ONTOLOGY, unit_name="旧", description="旧")],
            candidates=[UnitCandidate(id="cand_old", unit_id="unit_old", unit_name="旧", description="x", chain_reaction="y", main_operator="distort")],
            dimension_status="diverged",
        )],
        committed_concept={"one_line": "old"},
    )
    atomic_write_state("proj_test", state)

    # 5-dimension payload (plan bug fix: original was 1-dimension, which contradicts
    # the 5-dimension guard. Use full 5-dim payload with insight="新".)
    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [
            {"dimension": "ontology", "insight": "新", "units": [{"unit_name": "新u", "description": "新d"}]},
            {"dimension": "energetics", "insight": "新2", "units": []},
            {"dimension": "power_structure", "insight": "新3", "units": []},
            {"dimension": "protagonist_engine", "insight": "新4", "units": []},
            {"dimension": "narrative_physics", "insight": "新5", "units": []},
        ],
        "causal_map": "new", "top_level_summary": "新总结",
    }, ensure_ascii=False)}

    await engine.decompose("proj_test", RawIntent(prompt="新", genre_primary="修仙"))
    loaded = load_state("proj_test")
    assert loaded.dimensions[0].insight == "新"
    assert loaded.dimensions[0].candidates == []  # downstream cleared
    assert loaded.committed_concept is None  # downstream cleared


@pytest.mark.asyncio
async def test_decompose_raises_on_invalid_json(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": "not json"}
    with pytest.raises(Exception):
        await engine.decompose("proj_test", RawIntent(prompt="x", genre_primary="y"))


@pytest.mark.asyncio
async def test_decompose_raises_when_less_than_5_dimensions(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [{"dimension": "ontology", "insight": "x", "units": []}],
        "causal_map": "y", "top_level_summary": "z",
    }, ensure_ascii=False)}
    with pytest.raises(ValueError, match="5 维度"):
        await engine.decompose("proj_test", RawIntent(prompt="x", genre_primary="y"))
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "decompose"
```

Expected: AttributeError / TypeError(`ThreeBEngine.decompose` 不存在)。

- [ ] **Step 3: 实现 ThreeBEngine.decompose**

```python
class ThreeBEngine:
    def __init__(self, model_router=None) -> None:
        self._router = model_router

    async def decompose(
        self, project_id: str, raw_intent: RawIntent
    ) -> tuple[list[DimensionDecomposition], str, str]:
        """1 LLM call → (dimensions, causal_map, top_level_summary)."""
        prompt_data = load_prompt_effective(DECOMPOSE_PROMPT)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
        )
        response = await self._router.execute(
            agent_name="three_b",
            task_name="decompose",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 8192),
        )
        raw_text = response.get("content", "")
        dims, causal_map, summary = self._parse_decompose_output(raw_text)
        now = _now_iso()
        state = load_state(project_id) or ThreeBState(project_id=project_id)
        # 清空下游(decompose 自身的 dimensions 字段会被覆盖)
        state.dimensions = dims
        state.causal_map = causal_map
        state.top_level_summary = summary
        state.raw_intent = raw_intent
        state.decompose_started_at = now
        state.decompose_completed_at = now
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
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as e:
            raise ValueError(f"decompose: LLM 返回非 JSON: {e}") from e
        if not isinstance(data, dict):
            raise ValueError("decompose: LLM 输出不是 dict")
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
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "decompose"
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.decompose (5 维度 + insight + causal_map + summary)"
```

---

## Task 4: engine.follow_up_unit

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_follow_up_unit_replaces_description_in_place(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="old desc")],
        )],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({
        "unit_name": "灵窍", "description": "new desc",
    }, ensure_ascii=False)}

    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question="能更具体吗?")
    assert unit.description == "new desc"
    assert unit.follow_up_count == 1

    reloaded = load_state("proj_test")
    assert reloaded.dimensions[0].units[0].description == "new desc"
    assert reloaded.dimensions[0].units[0].follow_up_count == 1


@pytest.mark.asyncio
async def test_follow_up_unit_empty_question_uses_default(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d")],
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"unit_name": "x", "description": "d2"})}
    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question=None)
    assert unit.follow_up_count == 1
    assert unit.description == "d2"


@pytest.mark.asyncio
async def test_follow_up_unit_rejects_irreducible(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d", is_irreducible=True)],
    )])
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="不可约化"):
        await engine.follow_up_unit("proj_test", "unit_abc", user_question="x")


@pytest.mark.asyncio
async def test_follow_up_unit_preserves_is_irreducible_flag(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d")],
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"unit_name": "x", "description": "d2", "is_irreducible": True})}
    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question="x")
    assert unit.is_irreducible is True
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "follow_up_unit"
```

Expected: AttributeError(`follow_up_unit` 不存在)。

- [ ] **Step 3: 实现 follow_up_unit**

```python
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

        prompt_data = load_prompt_effective(FOLLOW_UP_PROMPT)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            unit_name=target.unit_name,
            description=target.description,
            user_question=user_question or "(无明确问题,请基于该单元当前描述做一次深化)",
        )
        response = await self._router.execute(
            agent_name="three_b",
            task_name="follow_up",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 2048),
        )
        raw = json.loads(response.get("content", ""))
        target.description = raw.get("description", target.description) or target.description
        if raw.get("unit_name"):
            target.unit_name = raw["unit_name"]
        if raw.get("is_irreducible") is True:
            target.is_irreducible = True
        target.follow_up_count += 1
        atomic_write_state(project_id, state)
        return target

    def _find_unit(self, state: ThreeBState, unit_id: str) -> Optional[Unit]:
        for d in state.dimensions:
            for u in d.units:
                if u.id == unit_id:
                    return u
        return None
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "follow_up_unit"
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.follow_up_unit (原地替换 + 计数)"
```

---

## Task 5: engine.diverge per-unit 自适应

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_diverge_runs_one_llm_per_unit_in_parallel(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [
        Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}")
        for i in range(3)
    ]
    state = ThreeBState(project_id="proj_test", dimensions=[
        DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units),
    ])
    atomic_write_state("proj_test", state)

    async def fake_execute(*args, **kwargs):
        return {"content": json.dumps({
            "candidates": [
                {"description": f"v{i}", "chain_reaction": f"cr{i}", "main_operator": "distort", "selection_rank": i}
                for i in range(2)
            ],
        }, ensure_ascii=False)}
    mock_router.execute.side_effect = fake_execute

    dims = await engine.diverge("proj_test")
    assert len(dims) == 1
    assert mock_router.execute.call_count == 3  # per-unit LLM 调用
    # 每个 unit 2 候选
    for unit in units:
        cands = [c for c in dims[0].candidates if c.unit_id == unit.id]
        assert len(cands) == 2


@pytest.mark.asyncio
async def test_diverge_degrades_per_unit_on_failure(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(3)]
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i", units=units,
    )])
    atomic_write_state("proj_test", state)

    async def fake_execute(*args, **kwargs):
        if "unit_0" in kwargs.get("messages", [{}])[1].get("content", ""):
            raise RuntimeError("LLM 超时")
        return {"content": json.dumps({"candidates": [
            {"description": "v", "chain_reaction": "cr", "main_operator": "distort", "selection_rank": 0},
        ]})}
    mock_router.execute.side_effect = fake_execute

    dims = await engine.diverge("proj_test")
    cands_per_unit = {c.unit_id: c for u in units for c in dims[0].candidates if c.unit_id == u.id}
    assert "unit_0" not in cands_per_unit  # unit_0 失败,candidates 空
    assert "unit_1" in cands_per_unit
    assert "unit_2" in cands_per_unit


@pytest.mark.asyncio
async def test_diverge_clears_committed_concept(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        committed_concept={"one_line": "old"},
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_1", dimension=DimLabel.ONTOLOGY, unit_name="u", description="d")],
        )],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"candidates": [{"description": "v", "chain_reaction": "cr", "main_operator": "distort", "selection_rank": 0}]})}
    await engine.diverge("proj_test")
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept is None


@pytest.mark.asyncio
async def test_diverge_raises_when_all_units_fail(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(2)]
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i", units=units,
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.side_effect = RuntimeError("全部失败")
    with pytest.raises(RuntimeError, match="全部失败"):
        await engine.diverge("proj_test")
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "diverge"
```

Expected: AttributeError。

- [ ] **Step 3: 实现 diverge**

```python
    async def diverge(self, project_id: str) -> list[DimensionDecomposition]:
        """对所有 units 并行调用自适应发散。N units × 1 LLM, asyncio.gather(Semaphore(5))。"""
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

        tasks = [_diverge_unit(d, u) for d, u in all_units]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 写盘:组装 candidates 到对应 dimension
        for (dim, unit), res in zip(all_units, results):
            if isinstance(res, Exception):
                logger.warning("diverge unit %s failed: %s", unit.id, res)
                continue
            dim.candidates.extend(res)

        # dimension_status 推算
        for dim in state.dimensions:
            any_cands = any(len(u) > 0 for u in dim.candidates) if False else bool(dim.candidates)
            # 注:dim.candidates 是该维度所有 unit 的 candidates 列表
            if not dim.candidates:
                dim.dimension_status = "divergence_failed"
            else:
                dim.dimension_status = "diverged"

        # 全部失败检查
        if all(len(res) == 0 or isinstance(res, Exception) for res in results):
            raise RuntimeError("全部 unit 发散失败")

        now = _now_iso()
        state.diverge_started_at = now
        state.diverge_completed_at = now
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
        prompt_data = load_prompt_effective(ADAPTIVE_DIVERGE_PROMPT)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = prompt_data["user_prompt_template"].format(
            prompt=raw_intent.prompt,
            genre_primary=raw_intent.genre_primary,
            genre_secondary=raw_intent.genre_secondary or "(无)",
            dimension=dim.dimension.value,
            unit_name=unit.unit_name,
            unit_description=unit.description,
        )
        response = await self._router.execute(
            agent_name="three_b",
            task_name="diverge_unit",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.9),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        return self._parse_adaptive_diverge_output(response.get("content", ""), unit)

    def _parse_adaptive_diverge_output(self, raw_text: str, unit: Unit) -> list[UnitCandidate]:
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
                continue
            if "chain_reaction" not in c:
                continue
            aux = c.get("aux_operator")
            if aux is not None and aux not in OPERATORS:
                aux = None
            out.append(UnitCandidate(
                id=_new_id("cand"),
                unit_id=unit.id,
                unit_name=unit.unit_name,
                description=c.get("description", "") or "",
                chain_reaction=c.get("chain_reaction", "") or "",
                main_operator=main_op,
                aux_operator=aux,
                selection_rank=int(c.get("selection_rank", 0)),
            ))
        return out
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "diverge"
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.diverge per-unit 自适应发散 (asyncio.gather(5))"
```

---

## Task 6: engine.regenerate_unit + select_unit_candidate

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_regenerate_unit_replaces_candidates_for_that_unit_only(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[
                Unit(id="unit_a", dimension=DimLabel.ONTOLOGY, unit_name="a", description="da"),
                Unit(id="unit_b", dimension=DimLabel.ONTOLOGY, unit_name="b", description="db"),
            ],
            candidates=[
                UnitCandidate(id="cand_old_a1", unit_id="unit_a", unit_name="a", description="old_a1", chain_reaction="r", main_operator="distort"),
                UnitCandidate(id="cand_old_a2", unit_id="unit_a", unit_name="a", description="old_a2", chain_reaction="r", main_operator="distort"),
                UnitCandidate(id="cand_old_b", unit_id="unit_b", unit_name="b", description="old_b", chain_reaction="r", main_operator="distort"),
            ],
        )],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({"candidates": [
        {"description": "new_a1", "chain_reaction": "r", "main_operator": "break", "selection_rank": 0},
        {"description": "new_a2", "chain_reaction": "r", "main_operator": "break", "selection_rank": 1},
    ]})}

    new_cands = await engine.regenerate_unit("proj_test", "unit_a")
    assert len(new_cands) == 2
    assert all(c.unit_id == "unit_a" for c in new_cands)
    reloaded = load_state("proj_test")
    reloaded_a_cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "unit_a"]
    reloaded_b_cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "unit_b"]
    assert len(reloaded_a_cands) == 2  # unit_a 重生
    assert all(c.description.startswith("new_a") for c in reloaded_a_cands)
    assert len(reloaded_b_cands) == 1  # unit_b 保留
    assert reloaded_b_cands[0].description == "old_b"


def test_select_unit_candidate_swaps_rank(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_a", dimension=DimLabel.ONTOLOGY, unit_name="a", description="d")],
        candidates=[
            UnitCandidate(id="c1", unit_id="unit_a", unit_name="a", description="first", chain_reaction="r", main_operator="distort", selection_rank=0),
            UnitCandidate(id="c2", unit_id="unit_a", unit_name="a", description="second", chain_reaction="r", main_operator="distort", selection_rank=1),
        ],
    )])
    atomic_write_state("proj_test", state)
    dim = engine.select_unit_candidate("proj_test", "unit_a", candidate_index=1)
    cands = dim.candidates
    assert cands[1].selection_rank == 0  # 候选 1 提升到 rank 0
    assert cands[0].selection_rank == 1


def test_select_unit_candidate_rejects_out_of_range(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="u", dimension=DimLabel.ONTOLOGY, unit_name="u", description="d")],
        candidates=[UnitCandidate(id="c", unit_id="u", unit_name="u", description="d", chain_reaction="r", main_operator="distort")],
    )])
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="超出范围"):
        engine.select_unit_candidate("proj_test", "u", candidate_index=5)
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "regenerate or select_unit"
```

Expected: AttributeError。

- [ ] **Step 3: 实现**

```python
    async def regenerate_unit(self, project_id: str, unit_id: str) -> list[UnitCandidate]:
        """重跑该 unit 的发散,只替换该 unit 的 candidates。"""
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError(f"项目 {project_id} 未发散")
        target_dim = None
        target_unit = None
        for d in state.dimensions:
            for u in d.units:
                if u.id == unit_id:
                    target_dim, target_unit = d, u
                    break
            if target_unit:
                break
        if target_unit is None:
            raise ValueError(f"unit {unit_id} 不存在")

        new_cands = await self._diverge_single_unit(state.raw_intent, target_dim, target_unit)
        if not new_cands:
            raise ValueError("regenerate_unit: LLM 未返回候选")

        # 替换 target_dim.candidates 中属于该 unit 的部分
        target_dim.candidates = [c for c in target_dim.candidates if c.unit_id != unit_id] + new_cands
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
            # 写回 d.candidates(替换对象)
            new_list = []
            for c in d.candidates:
                if c.unit_id == unit_id:
                    new_list.extend(cands)
                    # 避免重复追加
                    d.candidates = [x for x in d.candidates if x.unit_id != unit_id] + cands
                    break
            atomic_write_state(project_id, state)
            return d
        raise ValueError(f"unit {unit_id} 无候选")
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "regenerate or select_unit"
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.regenerate_unit + select_unit_candidate"
```

---

## Task 7: engine.commit

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_commit_synthesizes_5_fields(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(5)
    ]
    state = ThreeBState(
        project_id="proj_test",
        causal_map="A → B → C",
        top_level_summary="一句话总结",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({
        "one_line": "一句话", "expanded": "100-200字", "core_tension": "50-80字",
        "tone": "暗黑", "logline": "≤80字",
    }, ensure_ascii=False)}

    result = await engine.commit("proj_test")
    assert result["committed_concept"]["one_line"] == "一句话"
    assert result["committed_concept"]["tone"] == "暗黑"
    assert result["committed_concept"]["edited_by_user"] is False
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept["one_line"] == "一句话"


@pytest.mark.asyncio
async def test_commit_rejects_when_too_few_candidates(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    # 20 units,只有 2 个有候选 (< MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT = 3)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(20)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(2)
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="候选不足"):
        await engine.commit("proj_test")


@pytest.mark.asyncio
async def test_commit_includes_failed_units_in_prompt(tmp_path, monkeypatch, mock_router):
    """Failed units (no candidates) should be marked in prompt as [unit X 未参与]."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(3)  # 只有 3 个有候选
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)

    captured_messages = []
    async def fake_execute(*args, **kwargs):
        captured_messages.append(kwargs.get("messages"))
        return {"content": json.dumps({"one_line": "x", "expanded": "x", "core_tension": "x", "tone": "x", "logline": "x"})}
    mock_router.execute.side_effect = fake_execute

    await engine.commit("proj_test")
    user_msg = captured_messages[0][1]["content"]
    assert "未参与" in user_msg  # unit_3 和 unit_4 标记为未参与
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "commit"
```

Expected: AttributeError。

- [ ] **Step 3: 实现 commit**

```python
    async def commit(self, project_id: str) -> dict:
        """LLM 合成 5 字段 + novelty。≥3 units 有候选才允许。"""
        state = load_state(project_id)
        if state is None or state.raw_intent is None:
            raise ValueError(f"项目 {project_id} 未发散")

        units_with_cands = sum(1 for d in state.dimensions for u in d.units if any(c.unit_id == u.id for c in d.candidates))
        if units_with_cands < MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT:
            raise ValueError(f"候选不足:{units_with_cands} units 有候选 (< {MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT}),无法合成")

        prompt_data = load_prompt_effective(COMMIT_PROMPT)
        system = prompt_data["system_prompt"].format(negative_constraints="")
        user = self._build_commit_user_prompt(prompt_data, state)
        now = _now_iso()
        state.commit_started_at = now
        response = await self._router.execute(
            agent_name="three_b",
            task_name="commit",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            json_mode=True,
            temperature=prompt_data.get("temperature", 0.7),
            max_tokens=prompt_data.get("max_tokens", 4096),
        )
        raw = json.loads(response.get("content", "{}"))
        state.committed_concept = {
            "one_line": raw.get("one_line", "") or "",
            "expanded": raw.get("expanded", "") or "",
            "core_tension": raw.get("core_tension", "") or "",
            "tone": raw.get("tone", "") or "",
            "logline": raw.get("logline", "") or "",
            "edited_by_user": False,
        }
        # novelty(复用 novelty_evaluator)
        from backend.creative_os.novelty_evaluator import NoveltyEvaluator
        novelty = NoveltyEvaluator().evaluate(state.committed_concept)
        state.novelty_scores = novelty
        state.commit_completed_at = _now_iso()
        atomic_write_state(project_id, state)
        return {"committed_concept": state.committed_concept, "novelty_scores": state.novelty_scores}

    def _build_commit_user_prompt(self, prompt_data: dict, state: ThreeBState) -> str:
        selected_units: list[str] = []
        for d in state.dimensions:
            for u in d.units:
                cand = next((c for c in d.candidates if c.unit_id == u.id and c.selection_rank == 0), None)
                if cand:
                    selected_units.append(f"- [{d.dimension.value}] {u.unit_name}: {cand.description}\n  连锁推演: {cand.chain_reaction}")
                else:
                    selected_units.append(f"- [{d.dimension.value}] {u.unit_name}: [unit {u.id} 未参与]")
        return prompt_data["user_prompt_template"].format(
            prompt=state.raw_intent.prompt,
            genre_primary=state.raw_intent.genre_primary,
            causal_map=state.causal_map,
            top_level_summary=state.top_level_summary,
            selected_units="\n".join(selected_units),
        )
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "commit"
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.commit (5 字段合成 + ≥3 units 拒绝)"
```

---

## Task 8: engine.edit_committed_concept

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_edit_committed_concept_overrides_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(
        project_id="proj_test",
        committed_concept={"one_line": "原", "expanded": "原", "core_tension": "原", "tone": "原", "logline": "原", "edited_by_user": False},
    )
    atomic_write_state("proj_test", state)
    result = await engine.edit_committed_concept("proj_test", {"one_line": "新", "tone": "新调"})
    assert result["committed_concept"]["one_line"] == "新"
    assert result["committed_concept"]["tone"] == "新调"
    assert result["committed_concept"]["expanded"] == "原"  # 未编辑字段保留
    assert result["committed_concept"]["edited_by_user"] is True


@pytest.mark.asyncio
async def test_edit_committed_concept_rejects_unknown_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", committed_concept={"one_line": "x"})
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="未知字段"):
        await engine.edit_committed_concept("proj_test", {"unknown_field": "y"})


@pytest.mark.asyncio
async def test_edit_committed_concept_rejects_when_no_concept(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="未提交"):
        await engine.edit_committed_concept("proj_test", {"one_line": "x"})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "edit"
```

Expected: AttributeError。

- [ ] **Step 3: 实现**

```python
    ALLOWED_EDIT_FIELDS = {"one_line", "expanded", "core_tension", "tone", "logline"}

    async def edit_committed_concept(
        self, project_id: str, edited_fields: dict
    ) -> dict:
        state = load_state(project_id)
        if state is None or state.committed_concept is None:
            raise ValueError("committed_concept 不存在,无法编辑")
        unknown = set(edited_fields.keys()) - self.ALLOWED_EDIT_FIELDS
        if unknown:
            raise ValueError(f"未知字段: {unknown}")
        for k, v in edited_fields.items():
            state.committed_concept[k] = v
        state.committed_concept["edited_by_user"] = True
        atomic_write_state(project_id, state)
        return {"committed_concept": state.committed_concept}
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "edit"
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.edit_committed_concept (5 字段白名单)"
```

---

## Task 9: engine.advance

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`

- [ ] **Step 1: 写失败测试**

```python
@pytest.mark.asyncio
async def test_advance_writes_concept_and_dna_and_divergence(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        committed_concept={"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v", "edited_by_user": False},
        novelty_scores={"composite": 60, "grade": "B+"},
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v"})}

    result = await engine.advance("proj_test")
    assert result["written"] is True
    assert "committed_at" in result

    # concept_and_dna.json
    dna_path = tmp_path / "proj_test" / "concept_and_dna.json"
    assert dna_path.exists()
    dna = json.loads(dna_path.read_text(encoding="utf-8"))
    assert dna["concept"]["one_line"] == "x"
    assert dna["story_dna"]["tone"] == "w"
    assert dna["novelty_scores"]["grade"] == "B+"
    assert dna["three_b_snapshot"]["schema_version"] == 2

    # creative_divergence.json
    div_path = tmp_path / "proj_test" / "creative_divergence.json"
    assert div_path.exists()
    div = json.loads(div_path.read_text(encoding="utf-8"))
    assert div["source"] == "creative_divergence"
    assert "修仙" in div["prompt"]


@pytest.mark.asyncio
async def test_advance_calls_commit_when_no_concept(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    # 设 state 但 committed_concept = None + 充分 units 有候选
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(5)
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "auto", "expanded": "auto", "core_tension": "auto", "tone": "auto", "logline": "auto"})}

    await engine.advance("proj_test")
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept["one_line"] == "auto"
    assert (tmp_path / "proj_test" / "concept_and_dna.json").exists()


@pytest.mark.asyncio
async def test_advance_is_idempotent(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", committed_concept={"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v", "edited_by_user": False})
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "x"})}  # 不该被调用
    await engine.advance("proj_test")
    await engine.advance("proj_test")  # 第二次
    # mock_router.execute 应只调用 0 次(committed_concept 已存在)
    assert mock_router.execute.call_count == 0
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "advance"
```

Expected: AttributeError。

- [ ] **Step 3: 实现 advance**

```python
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
```

- [ ] **Step 4: 跑测试**

```bash
pytest tests/test_creative_os/test_three_b_engine.py -v -k "advance"
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(divergence): implement engine.advance (写 concept_and_dna.json + creative_divergence.json)"
```

---

## Task 10: Prompt YAML — three_b_decompose

**Files:**
- Create: `backend/prompts/creative/three_b_decompose.yaml`

- [ ] **Step 1: 创建 YAML**

```yaml
name: three_b_decompose
provider: default
model: default
temperature: 0.7
max_tokens: 8192

system_prompt: |
  你是一位精通叙事学、系统论与第一性原理的创意架构师。
  你的任务是将任何给定的创意点子,按第一性原理拆解至不可再分的基本单元,揭示其底层运行逻辑。

  # 核心方法论
  第一性原理 = 剥离一切类比、套路与表层设定,追问"这个东西如果从未存在过,要从零开始构建它,需要哪些不可再少的基本要素?"

  # 分析框架(五大维度)
  对以下 5 个维度逐一解构,每个维度产出:
  1. 定义该维度的"核心洞察"(一句话点破本质)
  2. 该维度的 3-5 个基本单元(unit_name + description)

  ## 维度一:世界构成的第一性(Ontology)
  - 基本单元方向:世界(空间+规则+能量池)、天道(根本算法)、本源(底层储备)、入侵(规则覆盖)
  ## 维度二:能量体系的第一性(Energetics)
  - 基本单元方向:修行(建立能量通道)、灵窍(接口)、种子(认证密钥+频率调谐器)、能量形式、排斥性
  ## 维度三:社会控制的第一性(Power Structure)
  - 基本单元方向:统治三要素(资源控制+知识垄断+意识形态塑造)、反抗三路径、普适性困境
  ## 维度四:主角机制的第一性(Protagonist Engine)
  - 基本单元方向:穿越(跨世界信息迁移)、外挂本质、伪装机制、双体系、献祭
  ## 维度五:叙事动力的第一性(Narrative Physics)
  - 基本单元方向:核心矛盾、解决路径、牺牲的必要性、持久战逻辑

  # 分析原则
  - 禁止套用"废柴逆袭""系统流""黑暗流"等标签化表述
  - 所有设定必须能回答"如果这个世界真实存在,这个规则如何被世界内的居民观测和验证?"
  - 主角的外挂必须能被拆解为"输入什么、处理逻辑是什么、输出什么",禁止用"神秘力量"敷衍

  # 输出格式
  严格 JSON,结构如下:
  {{
    "dimensions": [
      {{
        "dimension": "ontology",
        "insight": "一句话核心洞察",
        "units": [
          {{"unit_name": "网文子域标签(如 灵窍)", "description": "该单元的当前描述(50-150字)"}}
        ]
      }},
      // energetics, power_structure, protagonist_engine, narrative_physics 同上
    ],
    "causal_map": "5 维度之间的因果传导链(ASCII 或简短文本,如 'ontology → energetics → power_structure → protagonist_engine → narrative_physics')",
    "top_level_summary": "终极总结(≤150 字):这个故事在最底层究竟是什么"
  }}

  {negative_constraints}

user_prompt_template: |
  原始创意点子: {prompt}
  主类型: {genre_primary}
  副类型(可选): {genre_secondary}

  请按 5 维度逐一拆解,每维度 3-5 个基本单元,产出 insight + causal_map + top_level_summary。
  输出严格 JSON,不要任何额外文字。

output_format:
  type: json
```

- [ ] **Step 2: 写 YAML 测试**

修改 `backend/tests/test_three_b_yaml.py`,在文件顶部加 import:

```python
import yaml
```

然后加新测试:

```python
def test_three_b_decompose_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    assert p.exists(), f"{p} 不存在"


def test_three_b_decompose_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "three_b_decompose"
    assert "5 维度" in data["system_prompt"] or "ontology" in data["system_prompt"].lower()
    assert "{prompt}" in data["user_prompt_template"]
    assert "causal_map" in data["system_prompt"] or "causal_map" in data["user_prompt_template"]
    assert "top_level_summary" in data["system_prompt"] or "top_level_summary" in data["user_prompt_template"]
```

- [ ] **Step 3: 跑测试**

```bash
pytest backend/tests/test_three_b_yaml.py -v -k "decompose"
```

Expected: 2 passed。

- [ ] **Step 4: Commit**

```bash
git add backend/prompts/creative/three_b_decompose.yaml backend/tests/test_three_b_yaml.py
git commit -m "feat(prompt): add three_b_decompose.yaml (5 维度拆解 + insight + causal_map + summary)"
```

---

## Task 11: Prompt YAML — three_b_adaptive_diverge

**Files:**
- Create: `backend/prompts/creative/three_b_adaptive_diverge.yaml`

- [ ] **Step 1: 创建 YAML**

```yaml
name: three_b_adaptive_diverge
provider: default
model: default
temperature: 0.9
max_tokens: 4096

system_prompt: |
  你是小说创意发散顾问。基于 `docs/design/自适应发散引擎.md` 的方法论,对单个 Unit 做扫描+路由+主辅算子发散。

  # 核心原则
  - 不询问、不确认,直接诊断、直接执行
  - 每个发散方向必须附带"连锁推演"(规则改变后社会/人物/冲突如何连锁变化)
  - 所有创新建立在用户已有素材上,不凭空创造无关内容

  # 第一步:设定特征扫描(内部思考,不输出)
  收到该 Unit 后,扫描以下维度:
  - 因果规则密度:是否有"如果X则Y""每当…""只有…才…"等明确规则
  - 社会结构完整度:是否包含社会组织、阶层、制度、文化习俗
  - 机制聚焦度:是否围绕单一能力/物品/技术/生物展开
  - 抽象层级:是具象规则,还是高度抽象的概念/意象
  - 子规则数量:是否包含多个嵌套或并列的子规则

  # 第二步:自动匹配算子(主+辅)
  根据扫描结果,自动匹配:
  - 明确因果规则型 → 主扭曲 + 辅打破
  - 完整社会结构型 → 主打破 + 辅融合
  - 单一机制/能力型 → 主融合 + 辅扭曲
  - 高度抽象概念型 → 主融合 + 辅打破
  - 多子规则复合型 → 主组合链

  # 第三步:4 算子定义
  ## 【扭曲】参数调试
  改变该 Unit 某个核心参数:范围/频率/强度/条件/感知/方向
  ## 【打破】前提拆解
  质疑并拆除默认前提:普遍性/恒常性/单向性/无害性/独立性
  ## 【融合】系统嫁接
  将该 Unit 作为模块,插入另一个规则系统(经济/政治/教育/情感/物理/宗教/军事/医疗/媒介/生态)
  ## 【组合链】(本 spec 中视为单算子)
  LLM 内部综合多算子思路,但**只输出 1 候选**(不实际多步调用)

  # 输出格式
  严格 JSON:
  {{
    "candidates": [
      {{
        "description": "该 Unit 变异后的核心描述(50-150字)",
        "chain_reaction": "连锁推演:这个改变会在世界中引发什么?(80-150字)",
        "main_operator": "distort|break|blend|chain",
        "aux_operator": "distort|break|blend|chain 或 null",
        "selection_rank": 0
      }},
      // 至少 2 个候选,通常 2-3 个
    ]
  }}

  {negative_constraints}

user_prompt_template: |
  原始创意: {prompt}
  主类型: {genre_primary}
  副类型(可选): {genre_secondary}

  当前维度: {dimension}
  当前单元: {unit_name}
  单元描述: {unit_description}

  请扫描该 Unit 的设定特征,自动匹配主辅算子,产出 2-3 个候选。每个候选必须包含 description + chain_reaction + main_operator + selection_rank。
  输出严格 JSON,不要任何额外文字。

output_format:
  type: json
```

- [ ] **Step 2: 写 YAML 测试**

在 `backend/tests/test_three_b_yaml.py` 加:

```python
def test_three_b_adaptive_diverge_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_adaptive_diverge.yaml")
    assert p.exists()


def test_three_b_adaptive_diverge_yaml_includes_4_operators_and_chain_reaction():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_adaptive_diverge.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    content = data["system_prompt"] + data["user_prompt_template"]
    for op in ("扭曲", "打破", "融合", "组合链"):
        assert op in content, f"算子 {op} 不在 prompt 中"
    assert "chain_reaction" in content
    assert "{unit_name}" in data["user_prompt_template"]
    assert "{unit_description}" in data["user_prompt_template"]
```

- [ ] **Step 3: 跑测试**

```bash
pytest backend/tests/test_three_b_yaml.py -v -k "adaptive_diverge"
```

Expected: 2 passed。

- [ ] **Step 4: Commit**

```bash
git add backend/prompts/creative/three_b_adaptive_diverge.yaml backend/tests/test_three_b_yaml.py
git commit -m "feat(prompt): add three_b_adaptive_diverge.yaml (4 算子 + chain_reaction)"
```

---

## Task 12: Prompt YAML — three_b_follow_up + 修改 three_b_commit + 删除旧 3 个

**Files:**
- Create: `backend/prompts/creative/three_b_follow_up.yaml`
- Modify: `backend/prompts/creative/three_b_commit.yaml`
- Delete: `backend/prompts/creative/three_b_breaking.yaml`
- Delete: `backend/prompts/creative/three_b_bending.yaml`
- Delete: `backend/prompts/creative/three_b_blending.yaml`

- [ ] **Step 1: 创建 three_b_follow_up.yaml**

```yaml
name: three_b_follow_up
provider: default
model: default
temperature: 0.7
max_tokens: 2048

system_prompt: |
  你是一位叙事学顾问,负责对已拆解出的某个基本单元做一次"追问式深化"。
  - 输入:该单元当前的 unit_name 和 description,以及用户的追问(可为空)
  - 输出:深化后的 unit_name(可与原名不同)+ 更具体/更深的 description
  - 若追问为空,默认追问:"该单元还有哪些被掩盖的运行机制?"

  ## 输出格式
  严格 JSON:
  {{
    "unit_name": "深化后的网文子域标签",
    "description": "深化后的描述(50-150字)",
    "is_irreducible": false
  }}

  若你认为该单元已不可再分(达到第一性原理的"原子"层),可设 "is_irreducible": true。

  {negative_constraints}

user_prompt_template: |
  当前单元名: {unit_name}
  当前描述: {description}
  用户追问: {user_question}

  请输出深化后的 JSON。

output_format:
  type: json
```

- [ ] **Step 2: 替换 three_b_commit.yaml(原 v1 内容)为 v2**

完整文件:

```yaml
name: three_b_commit
provider: default
model: default
temperature: 0.7
max_tokens: 4096

system_prompt: |
  你是一位小说概念合成师。基于用户已经选定的"维度-单元-候选"组合 + 全局 causal_map + top_level_summary,合成一个完整的创意概念。

  ## 输出字段
  严格 JSON:
  {{
    "one_line": "≤50 字,一句话概括核心创意",
    "expanded": "100-200 字,完整描述故事核心",
    "core_tension": "50-80 字,核心矛盾/张力",
    "tone": "调性标签(如:暗黑悬疑 / 热血成长 / 史诗奇幻)",
    "logline": "≤80 字,影视 logline 风格的故事简介"
  }}

  ## 合成原则
  - one_line 应直击用户原始创意的核心意图(与 top_level_summary 对齐)
  - core_tension 应从 causal_map 中提炼最核心的因果冲突
  - tone 应与用户主类型(genre_primary)匹配
  - logline 应能独立成句,作为下游 stage2_world_char 的种子
  - 未参与的 unit([unit X 未参与])不写入 concept,但保持因果合理性

  {negative_constraints}

user_prompt_template: |
  原始创意: {prompt}
  主类型: {genre_primary}

  全局因果图谱:
  {causal_map}

  全局总结(终极总结):
  {top_level_summary}

  选定单元(含连锁推演):
  {selected_units}

  请合成 5 字段 concept。输出严格 JSON,不要任何额外文字。

output_format:
  type: json
```

- [ ] **Step 3: 删除 3 个旧 3B yaml**

```bash
git rm backend/prompts/creative/three_b_breaking.yaml backend/prompts/creative/three_b_bending.yaml backend/prompts/creative/three_b_blending.yaml
```

- [ ] **Step 4: 修改 YAML 测试**

替换 `backend/tests/test_three_b_yaml.py` 中所有 v1 算子测试为新测试:

```python
# 删除旧测试:
# - test_three_b_breaking_yaml_exists / test_three_b_bending_yaml_exists / test_three_b_blending_yaml_exists
# - test_three_b_breaking_yaml_schema / test_three_b_bending_yaml_schema / test_three_b_blending_yaml_schema

# 新增:
def test_old_3b_yamls_deleted():
    from pathlib import Path
    for name in ("three_b_breaking", "three_b_bending", "three_b_blending"):
        p = Path(f"backend/prompts/creative/{name}.yaml")
        assert not p.exists(), f"旧 {name}.yaml 应已删除"


def test_three_b_follow_up_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_follow_up.yaml")
    assert p.exists()


def test_three_b_follow_up_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_follow_up.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "three_b_follow_up"
    assert "{unit_name}" in data["user_prompt_template"]


def test_three_b_commit_yaml_uses_causal_map_and_summary():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_commit.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    tpl = data["user_prompt_template"]
    assert "{causal_map}" in tpl
    assert "{top_level_summary}" in tpl
    assert "{selected_units}" in tpl


def test_all_v2_yamls_in_creative_dir():
    from pathlib import Path
    expected = {"three_b_decompose", "three_b_follow_up", "three_b_adaptive_diverge", "three_b_commit"}
    found = {p.stem for p in Path("backend/prompts/creative/").glob("three_b_*.yaml")}
    assert expected.issubset(found)
```

- [ ] **Step 5: 跑测试**

```bash
pytest backend/tests/test_three_b_yaml.py -v
```

Expected: 所有 v2 yaml 测试通过,旧 3B yamls 删除测试通过。

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/creative/three_b_follow_up.yaml backend/prompts/creative/three_b_commit.yaml backend/tests/test_three_b_yaml.py
git commit -m "feat(prompt): add three_b_follow_up + rewrite three_b_commit; remove 3B yamls"
```

---

## Task 13: API routes 10 端点

**Files:**
- Modify: `backend/api/three_b_routes.py`(完整重写)

- [ ] **Step 1: 重写文件顶部 docstring + imports**

```python
"""4 阶段创意发散 API 路由。

Mounted at /api/v1/projects/{project_id}/creative/diverge/three-b/*.

端点(共 10):
- GET    /state              — 读 state(走 migrate)
- DELETE /state              — 删 state
- POST   /decompose          — Stage 2 拆解
- POST   /follow-up          — Stage 2 追问单 unit
- POST   /diverge            — Stage 3 per-unit 自适应发散
- POST   /regenerate-unit    — Stage 3 单 unit 重生
- POST   /select-unit        — Stage 3 切换候选
- POST   /commit             — Stage 4 LLM 合成 5 字段
- POST   /edit-concept       — Stage 4 用户编辑
- POST   /advance            — Stage 4 写盘(commit-and-advance)
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.creative_os.three_b_engine import (
    RawIntent,
    ThreeBEngine,
    load_state,
    migrate_state_on_load,
)
from backend.services.dimension_labels import Dimension

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/projects/{project_id}/creative/diverge/three-b",
    tags=["three_b"],
)


def _get_engine(request: Request) -> ThreeBEngine:
    """Get ThreeBEngine singleton (created in app lifespan or on-demand)."""
    engine = getattr(request.app.state, "three_b_engine", None)
    if engine is None:
        from backend.llm.model_router import ModelRouter
        engine = ThreeBEngine(model_router=ModelRouter())
        request.app.state.three_b_engine = engine
    return engine
```

- [ ] **Step 2: 加 request/response models**

```python
class DecomposeRequest(BaseModel):
    prompt: str = Field(..., min_length=10)
    genre_primary: str
    genre_secondary: Optional[str] = None


class FollowUpRequest(BaseModel):
    unit_id: str
    user_question: Optional[str] = None


class RegenerateUnitRequest(BaseModel):
    unit_id: str


class SelectUnitRequest(BaseModel):
    unit_id: str
    candidate_index: int = Field(..., ge=0)


class EditConceptRequest(BaseModel):
    one_line: Optional[str] = None
    expanded: Optional[str] = None
    core_tension: Optional[str] = None
    tone: Optional[str] = None
    logline: Optional[str] = None
```

- [ ] **Step 3: GET /state + DELETE /state**

```python
@router.get("/state")
async def get_state(project_id: str):
    state = migrate_state_on_load(project_id)
    if state is None:
        raise HTTPException(status_code=404, detail="state 不存在(项目未启动创意发散或已迁移)")
    return _serialize_state(state)


@router.delete("/state")
async def delete_state(project_id: str):
    from pathlib import Path
    from backend.config import settings
    p = Path(settings.projects_dir) / project_id / "creative_os" / "three_b_state.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="state 不存在")
    p.unlink()
    return {"deleted": True}


def _serialize_state(state):
    """Convert ThreeBState dataclass to JSON-friendly dict."""
    from dataclasses import asdict
    return asdict(state)
```

- [ ] **Step 4: POST /decompose**

```python
@router.post("/decompose")
async def decompose(project_id: str, body: DecomposeRequest, request: Request):
    engine = _get_engine(request)
    try:
        dimensions, causal_map, summary = await engine.decompose(
            project_id, RawIntent(prompt=body.prompt, genre_primary=body.genre_primary, genre_secondary=body.genre_secondary),
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("decompose failed")
        raise HTTPException(status_code=503, detail=f"DECOMPOSE_FAILED: {e}")
    return {"dimensions": _serialize_dimensions(dimensions), "causal_map": causal_map, "top_level_summary": summary}


def _serialize_dimensions(dims):
    from dataclasses import asdict
    return [asdict(d) for d in dims]
```

- [ ] **Step 5: POST /follow-up**

```python
@router.post("/follow-up")
async def follow_up(project_id: str, body: FollowUpRequest, request: Request):
    engine = _get_engine(request)
    try:
        unit = await engine.follow_up_unit(project_id, body.unit_id, body.user_question)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    from dataclasses import asdict
    return {"unit": asdict(unit)}
```

- [ ] **Step 6: POST /diverge /regenerate-unit /select-unit**

```python
@router.post("/diverge")
async def diverge(project_id: str, request: Request):
    engine = _get_engine(request)
    try:
        dims = await engine.diverge(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("diverge failed")
        raise HTTPException(status_code=503, detail=f"DIVERGE_FAILED: {e}")
    return {"dimensions": _serialize_dimensions(dims)}


@router.post("/regenerate-unit")
async def regenerate_unit(project_id: str, body: RegenerateUnitRequest, request: Request):
    engine = _get_engine(request)
    try:
        cands = await engine.regenerate_unit(project_id, body.unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("regenerate_unit failed")
        raise HTTPException(status_code=503, detail=f"REGENERATE_FAILED: {e}")
    from dataclasses import asdict
    return {"candidates": [asdict(c) for c in cands]}


@router.post("/select-unit")
async def select_unit(project_id: str, body: SelectUnitRequest, request: Request):
    engine = _get_engine(request)
    try:
        dim = engine.select_unit_candidate(project_id, body.unit_id, body.candidate_index)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    from dataclasses import asdict
    return {"dimension": asdict(dim)}
```

- [ ] **Step 7: POST /commit /edit-concept /advance**

```python
@router.post("/commit")
async def commit(project_id: str, request: Request):
    engine = _get_engine(request)
    try:
        result = await engine.commit(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("commit failed")
        raise HTTPException(status_code=503, detail=f"COMMIT_FAILED: {e}")
    return result


@router.post("/edit-concept")
async def edit_concept(project_id: str, body: EditConceptRequest, request: Request):
    engine = _get_engine(request)
    edited = {k: v for k, v in body.model_dump(exclude_none=True).items() if v is not None}
    try:
        result = await engine.edit_committed_concept(project_id, edited)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return result


@router.post("/advance")
async def advance(project_id: str, request: Request):
    engine = _get_engine(request)
    try:
        result = await engine.advance(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("advance failed")
        raise HTTPException(status_code=503, detail=f"ADVANCE_FAILED: {e}")
    return result
```

- [ ] **Step 8: 加 reset-and-restart (便捷)**

```python
@router.post("/reset-and-restart")
async def reset_and_restart(project_id: str):
    from pathlib import Path
    from backend.config import settings
    p = Path(settings.projects_dir) / project_id / "creative_os" / "three_b_state.json"
    if p.exists():
        p.unlink()
    return {"deleted": True}
```

- [ ] **Step 9: 重写 routes 测试**

修改 `backend/tests/test_api/test_three_b_routes.py`(完整替换为新契约)。重点测试:

```python
def test_decompose_422_on_too_short_prompt(test_client):
    r = test_client.post("/api/v1/projects/proj_x/creative/diverge/three-b/decompose", json={"prompt": "短", "genre_primary": "x"})
    assert r.status_code == 422


def test_state_404_when_no_file(test_client):
    r = test_client.get("/api/v1/projects/proj_nonexistent/creative/diverge/three-b/state")
    assert r.status_code == 404


def test_state_returns_v1_migration_as_null(test_client, tmp_path, monkeypatch):
    # 写一个 v1 state 文件 + mock settings.projects_dir
    ...
```

(完整测试代码在后续 Task 由工程师按端点逐一写。spec 仓库 `backend/tests/test_api/test_three_b_routes.py` 当前内容已用 v1 契约,需要工程师根据上面 10 个端点重写。)

- [ ] **Step 10: 跑测试**

```bash
pytest backend/tests/test_api/test_three_b_routes.py backend/tests/test_three_b_yaml.py tests/test_creative_os/test_three_b_engine.py -v
```

Expected: 所有已写测试通过。

- [ ] **Step 11: 启动后端做一次冒烟**

```bash
uvicorn backend.main:app --port 8000 &
sleep 3
curl -s http://localhost:8000/api/v1/projects/proj_test/creative/diverge/three-b/state | head
kill %1
```

Expected: 返回 404(项目不存在)或 mock 的 v1 migration null。

- [ ] **Step 12: Commit**

```bash
git add backend/api/three_b_routes.py backend/tests/test_api/test_three_b_routes.py
git commit -m "feat(api): rewrite three-b routes to 10 endpoints (delete apply-concept, add advance)"
```

---

## Task 14: 前端 types.ts 重写

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/types.ts`(完整重写)

- [ ] **Step 1: 替换为 v2 类型**

```typescript
// 创意发散 v2 类型定义(snake_case 转换在 api/client.ts 完成)

export type Dimension =
  | "ontology"
  | "energetics"
  | "power_structure"
  | "protagonist_engine"
  | "narrative_physics";

export type Operator = "distort" | "break" | "blend" | "chain";

export interface RawIntent {
  prompt: string;
  genre_primary: string;
  genre_secondary: string | null;
}

export interface Unit {
  id: string;
  dimension: Dimension;
  unit_name: string;
  description: string;
  follow_up_count: number;
  is_irreducible: boolean;
}

export interface UnitCandidate {
  id: string;
  unit_id: string;
  unit_name: string;
  description: string;
  chain_reaction: string;
  main_operator: Operator;
  aux_operator: Operator | null;
  selection_rank: number;
}

export interface DimensionDecomposition {
  dimension: Dimension;
  insight: string;
  units: Unit[];
  candidates: UnitCandidate[];
  dimension_status: "pending" | "decomposed" | "diverged" | "divergence_failed";
}

export interface CommittedConcept {
  one_line: string;
  expanded: string;
  core_tension: string;
  tone: string;
  logline: string;
  edited_by_user: boolean;
}

export interface NoveltyScores {
  market_saturation: number;
  trope_similarity: number;
  contradiction_depth: number;
  discussion_potential: number;
  composite: number;
  grade: string;
}

export interface ThreeBState {
  schema_version: 2;
  project_id: string;
  raw_intent: RawIntent | null;
  decompose_started_at: string | null;
  decompose_completed_at: string | null;
  causal_map: string;
  top_level_summary: string;
  dimensions: DimensionDecomposition[];
  diverge_started_at: string | null;
  diverge_completed_at: string | null;
  commit_started_at: string | null;
  commit_completed_at: string | null;
  committed_concept: CommittedConcept | null;
  novelty_scores: NoveltyScores | null;
}

// UI 辅助类型
export type SubStage = "1" | "2" | "3" | "4";
```

- [ ] **Step 2: 检查无遗漏引用**

```bash
cd frontend && grep -r "Candidate\|DeepenedCandidate\|OperatorColumn" src/components/wizard/divergence_v2/ --include="*.tsx" --include="*.ts" | head -20
```

如果还有引用旧类型的文件,在后续 Task 改;这里只重写 types.ts。

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 有错误(因为旧 S2DivergenceStep / S3DeepenStep 还在引用旧类型)。这是预期的,在 Task 22 删除旧文件后消失。

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/components/wizard/divergence_v2/types.ts
cd .. && git commit -m "feat(divergence): rewrite types.ts to v2 schema (Dimension/Unit/UnitCandidate/etc.)"
```

---

## Task 15: 前端 reducer 重写

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts`(完整重写)

- [ ] **Step 1: 替换 reducer**

```typescript
import { useReducer, useEffect, useCallback } from "react";
import * as api from "@/api/client";
import type {
  ThreeBState,
  DimensionDecomposition,
  Unit,
  UnitCandidate,
  CommittedConcept,
  NoveltyScores,
  SubStage,
} from "./types";

interface State {
  loading: boolean;
  error: string | null;
  rawIntent: RawIntent | null;
  dimensions: DimensionDecomposition[];
  causalMap: string;
  topLevelSummary: string;
  committedConcept: CommittedConcept | null;
  noveltyScores: NoveltyScores | null;
  followUpLoadingUnitId: string | null;
  currentSubStage: SubStage;
  completedSubStages: SubStage[];
  showUpgradeToast: boolean;
}

type Action =
  | { type: "HYDRATE"; state: ThreeBState | null }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "DECOMPOSE_START" }
  | { type: "DECOMPOSE_SUCCESS"; dimensions: DimensionDecomposition[]; causalMap: string; topLevelSummary: string }
  | { type: "DECOMPOSE_ERROR"; message: string }
  | { type: "FOLLOW_UP_START"; unitId: string }
  | { type: "FOLLOW_UP_SUCCESS"; unit: Unit }
  | { type: "FOLLOW_UP_ERROR"; message: string }
  | { type: "DIVERGE_START" }
  | { type: "DIVERGE_SUCCESS"; dimensions: DimensionDecomposition[] }
  | { type: "DIVERGE_ERROR"; message: string }
  | { type: "REGENERATE_UNIT_SUCCESS"; dimension: DimensionDecomposition }
  | { type: "SELECT_UNIT_CANDIDATE"; unitId: string; candidateIndex: number; dimension: DimensionDecomposition }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS"; committedConcept: CommittedConcept; noveltyScores: NoveltyScores }
  | { type: "COMMIT_ERROR"; message: string }
  | { type: "EDIT_CONCEPT_START" }
  | { type: "EDIT_CONCEPT_SUCCESS"; committedConcept: CommittedConcept }
  | { type: "ADVANCE_START" }
  | { type: "ADVANCE_SUCCESS"; committedAt: string }
  | { type: "ADVANCE_ERROR"; message: string }
  | { type: "JUMP_TO_STAGE"; stage: SubStage }
  | { type: "RESET" };

const initial: State = {
  loading: false,
  error: null,
  rawIntent: null,
  dimensions: [],
  causalMap: "",
  topLevelSummary: "",
  committedConcept: null,
  noveltyScores: null,
  followUpLoadingUnitId: null,
  currentSubStage: "1",
  completedSubStages: [],
  showUpgradeToast: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      if (action.state === null) {
        return { ...initial, showUpgradeToast: true };
      }
      const s = action.state;
      const completed: SubStage[] = ["1"];
      if (s.dimensions.length > 0) completed.push("2");
      if (s.dimensions.some((d) => d.candidates.length > 0)) completed.push("3");
      if (s.committed_concept !== null) completed.push("4");
      const currentSubStage: SubStage = s.committed_concept
        ? "4"
        : s.dimensions.some((d) => d.candidates.length > 0)
          ? "3"
        : s.dimensions.length > 0
          ? "2"
          : "1";
      return {
        ...state,
        rawIntent: s.raw_intent,
        dimensions: s.dimensions,
        causalMap: s.causal_map,
        topLevelSummary: s.top_level_summary,
        committedConcept: s.committed_concept,
        noveltyScores: s.novelty_scores,
        currentSubStage,
        completedSubStages: completed,
      };
    }
    case "JUMP_TO_STAGE":
      return { ...state, currentSubStage: action.stage, error: null };
    case "DECOMPOSE_START":
      return { ...state, loading: true, error: null };
    case "DECOMPOSE_SUCCESS":
      return {
        ...state,
        loading: false,
        dimensions: action.dimensions,
        causalMap: action.causalMap,
        topLevelSummary: action.topLevelSummary,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "2"])),
        currentSubStage: "2",
      };
    case "DECOMPOSE_ERROR":
      return { ...state, loading: false, error: action.message };
    case "FOLLOW_UP_START":
      return { ...state, followUpLoadingUnitId: action.unitId };
    case "FOLLOW_UP_SUCCESS":
      return {
        ...state,
        followUpLoadingUnitId: null,
        dimensions: state.dimensions.map((d) => ({
          ...d,
          units: d.units.map((u) => (u.id === action.unit.id ? action.unit : u)),
        })),
      };
    case "DIVERGE_START":
      return { ...state, loading: true, error: null };
    case "DIVERGE_SUCCESS":
      return {
        ...state,
        loading: false,
        dimensions: action.dimensions,
        committedConcept: null,
        noveltyScores: null,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "3"])),
        currentSubStage: "3",
      };
    case "REGENERATE_UNIT_SUCCESS":
      return {
        ...state,
        dimensions: state.dimensions.map((d) =>
          d.dimension === action.dimension.dimension ? action.dimension : d,
        ),
      };
    case "SELECT_UNIT_CANDIDATE":
      return {
        ...state,
        dimensions: state.dimensions.map((d) =>
          d.dimension === action.dimension.dimension ? action.dimension : d,
        ),
      };
    case "COMMIT_SUCCESS":
      return {
        ...state,
        loading: false,
        committedConcept: action.committedConcept,
        noveltyScores: action.noveltyScores,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "4"])),
        currentSubStage: "4",
      };
    case "EDIT_CONCEPT_SUCCESS":
      return { ...state, committedConcept: action.committedConcept };
    case "ADVANCE_SUCCESS":
      return { ...state, loading: false };
    case "ADVANCE_START":
      return { ...state, loading: true };
    case "ADVANCE_ERROR":
      return { ...state, loading: false, error: action.message };
    case "STAGE1_SUCCESS":
      return {
        ...state,
        rawIntent: action.intent,
        completedSubStages: Array.from(new Set([...state.completedSubStages, "1"])),
      };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

// selectors: 检测下游是否有数据(供 REQUEST_NEXT / ConfirmNextDialog 用)
export function hasDownstreamData(state: State, targetSubStage: SubStage): boolean {
  if (targetSubStage === "2") {
    return state.dimensions.length > 0 || state.committedConcept !== null;
  }
  if (targetSubStage === "3") {
    return state.dimensions.some((d) => d.candidates.length > 0) || state.committedConcept !== null;
  }
  if (targetSubStage === "4") {
    return state.committedConcept !== null;
  }
  return false;
}

export function useThreeBDivergence(projectId: string) {
  const [state, dispatch] = useReducer(reducer, initial);

  // hydrate
  useEffect(() => {
    let cancelled = false;
    api.getThreeBState(projectId).then((s) => {
      if (!cancelled) dispatch({ type: "HYDRATE", state: s });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // actions
  const decompose = useCallback(async (intent: RawIntent) => {
    dispatch({ type: "DECOMPOSE_START" });
    try {
      const r = await api.postThreeBDecompose(projectId, intent);
      dispatch({
        type: "DECOMPOSE_SUCCESS",
        dimensions: r.dimensions,
        causalMap: r.causal_map,
        topLevelSummary: r.top_level_summary,
      });
    } catch (e: any) {
      dispatch({ type: "DECOMPOSE_ERROR", message: e.message });
    }
  }, [projectId]);

  const followUp = useCallback(
    async (unitId: string, userQuestion: string | null) => {
      dispatch({ type: "FOLLOW_UP_START", unitId });
      try {
        const r = await api.postThreeBFollowUp(projectId, { unit_id: unitId, user_question: userQuestion });
        dispatch({ type: "FOLLOW_UP_SUCCESS", unit: r.unit });
      } catch (e: any) {
        dispatch({ type: "FOLLOW_UP_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const diverge = useCallback(async () => {
    dispatch({ type: "DIVERGE_START" });
    try {
      const r = await api.postThreeBDiverge(projectId);
      dispatch({ type: "DIVERGE_SUCCESS", dimensions: r.dimensions });
    } catch (e: any) {
      dispatch({ type: "DIVERGE_ERROR", message: e.message });
    }
  }, [projectId]);

  const regenerateUnit = useCallback(
    async (unitId: string) => {
      try {
        const r = await api.postThreeBRegenerateUnit(projectId, { unit_id: unitId });
        const dim = state.dimensions.find((d) => d.units.some((u) => u.id === unitId));
        if (dim) {
          const updatedDim = {
            ...dim,
            candidates: [
              ...dim.candidates.filter((c) => c.unit_id !== unitId),
              ...r.candidates,
            ],
          };
          dispatch({ type: "REGENERATE_UNIT_SUCCESS", dimension: updatedDim });
        }
      } catch (e: any) {
        dispatch({ type: "DIVERGE_ERROR", message: e.message });
      }
    },
    [projectId, state.dimensions],
  );

  const selectCandidate = useCallback(
    async (unitId: string, candidateIndex: number) => {
      try {
        const r = await api.postThreeBSelectUnit(projectId, { unit_id: unitId, candidate_index: candidateIndex });
        dispatch({
          type: "SELECT_UNIT_CANDIDATE",
          unitId,
          candidateIndex,
          dimension: r.dimension,
        });
      } catch (e: any) {
        dispatch({ type: "DIVERGE_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const commit = useCallback(async () => {
    dispatch({ type: "COMMIT_START" });
    try {
      const r = await api.postThreeBCommit(projectId);
      dispatch({
        type: "COMMIT_SUCCESS",
        committedConcept: r.committed_concept,
        noveltyScores: r.novelty_scores,
      });
    } catch (e: any) {
      dispatch({ type: "COMMIT_ERROR", message: e.message });
    }
  }, [projectId]);

  const editConcept = useCallback(
    async (fields: Partial<CommittedConcept>) => {
      dispatch({ type: "EDIT_CONCEPT_START" });
      try {
        const r = await api.postThreeBEditConcept(projectId, fields);
        dispatch({ type: "EDIT_CONCEPT_SUCCESS", committedConcept: r.committed_concept });
      } catch (e: any) {
        dispatch({ type: "COMMIT_ERROR", message: e.message });
      }
    },
    [projectId],
  );

  const advance = useCallback(async () => {
    dispatch({ type: "ADVANCE_START" });
    try {
      const r = await api.postThreeBAdvance(projectId);
      dispatch({ type: "ADVANCE_SUCCESS", committedAt: r.committed_at });
    } catch (e: any) {
      dispatch({ type: "ADVANCE_ERROR", message: e.message });
    }
  }, [projectId]);

  const jumpToStage = useCallback((stage: SubStage) => {
    dispatch({ type: "JUMP_TO_STAGE", stage });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    decompose,
    followUp,
    diverge,
    regenerateUnit,
    selectCandidate,
    commit,
    editConcept,
    advance,
    jumpToStage,
    reset,
  };
}
```

- [ ] **Step 2: 写 reducer 测试**

新建 `frontend/src/test/wizard/divergence_v2/useThreeBDivergence.test.ts`(完整测试覆盖 JUMP / DECOMPOSE / DIVERGE / SELECT / COMMIT / ADVANCE)。

重点测试:

```typescript
import { renderHook, act } from "@testing-library/react";
import { useThreeBDivergence, hasDownstreamData } from "@/components/wizard/divergence_v2/useThreeBDivergence";

jest.mock("@/api/client");

describe("useThreeBDivergence reducer", () => {
  it("JUMP_TO_STAGE 只切 UI state,不动数据", () => {
    // hydrate 一个有 data 的 state → JUMP_TO_STAGE → 验证数据保留
  });

  it("DECOMPOSE_SUCCESS 清空下游(candidates + committedConcept)", () => {
    // ...
  });

  it("DIVERGE_SUCCESS 清空下游(committedConcept + noveltyScores)", () => {
    // ...
  });

  it("COMMIT_SUCCESS 推进到 Stage 4", () => {
    // ...
  });

  it("hasDownstreamData 检测各阶段", () => {
    expect(hasDownstreamData({ dimensions: [], ...} as any, "2")).toBe(false);
    expect(hasDownstreamData({ dimensions: [mockDim], ...} as any, "2")).toBe(true);
    expect(hasDownstreamData({ ..., committedConcept: mockConcept } as any, "3")).toBe(true);
  });
});
```

完整测试代码由工程师按上述 cases 展开(参考 v1 测试目录 `frontend/src/test/wizard/divergence_v2/S2DivergenceStep.test.tsx` 的写法)。

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- useThreeBDivergence
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts frontend/src/test/wizard/divergence_v2/useThreeBDivergence.test.ts
git commit -m "feat(divergence): rewrite useThreeBDivergence reducer (JUMP/REQUEST_NEXT/4 阶段 actions)"
```

---

## Task 16: StepIndicator 改 4 阶段 + JUMP_TO_STAGE

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/StepIndicator.tsx`

- [ ] **Step 1: 替换为 4 阶段版本**

```tsx
import React from "react";
import type { SubStage } from "./types";

const STAGES: { key: SubStage; label: string }[] = [
  { key: "1", label: "1. 输入灵感" },
  { key: "2", label: "2. 第一性拆解" },
  { key: "3", label: "3. 自适应发散" },
  { key: "4", label: "4. 提交" },
];

interface Props {
  current: SubStage;
  completed: SubStage[];
  onStageClick: (stage: SubStage) => void;
}

export function StepIndicator({ current, completed, onStageClick }: Props) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STAGES.map((s, idx) => {
        const isCurrent = current === s.key;
        const isCompleted = completed.includes(s.key);
        const canJump = isCompleted && !isCurrent;
        return (
          <React.Fragment key={s.key}>
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onStageClick(s.key)}
              className={[
                "px-3 py-1.5 rounded text-sm transition-colors",
                isCurrent
                  ? "bg-blue-600 text-white"
                  : isCompleted
                    ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed",
              ].join(" ")}
              data-testid={`step-indicator-${s.key}`}
            >
              {s.label}
            </button>
            {idx < STAGES.length - 1 && <span className="text-gray-300">›</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 写测试**

修改 `frontend/src/test/wizard/divergence_v2/StepIndicator.test.tsx`(扩展为 4 阶段):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { StepIndicator } from "@/components/wizard/divergence_v2/StepIndicator";

describe("StepIndicator (4 stages)", () => {
  it("renders 4 stage buttons", () => {
    render(<StepIndicator current="1" completed={[]} onStageClick={jest.fn()} />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-4")).toBeInTheDocument();
  });

  it("completed stages are clickable", () => {
    const onClick = jest.fn();
    render(<StepIndicator current="3" completed={["1", "2", "3"]} onStageClick={onClick} />);
    fireEvent.click(screen.getByTestId("step-indicator-1"));
    expect(onClick).toHaveBeenCalledWith("1");
  });

  it("current stage is not clickable", () => {
    const onClick = jest.fn();
    render(<StepIndicator current="3" completed={["1", "2", "3"]} onStageClick={onClick} />);
    fireEvent.click(screen.getByTestId("step-indicator-3"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uncompleted stages are disabled", () => {
    render(<StepIndicator current="1" completed={[]} onStageClick={jest.fn()} />);
    expect(screen.getByTestId("step-indicator-4")).toBeDisabled();
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- StepIndicator
```

Expected: 4 passed。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/StepIndicator.tsx frontend/src/test/wizard/divergence_v2/StepIndicator.test.tsx
git commit -m "feat(divergence): StepIndicator 4 stages + onStageClick for JUMP_TO_STAGE"
```

---

## Task 17: ConfirmNextDialog

**Files:**
- Create: `frontend/src/components/wizard/divergence_v2/ConfirmNextDialog.tsx`
- Create: `frontend/src/test/wizard/divergence_v2/ConfirmNextDialog.test.tsx`

- [ ] **Step 1: 实现 dialog**

```tsx
import React from "react";
import type { SubStage } from "./types";

interface Props {
  open: boolean;
  targetStage: SubStage | null;
  affectedStages: SubStage[];
  onConfirm: () => void;
  onCancel: () => void;
}

const STAGE_LABELS: Record<SubStage, string> = {
  "1": "输入灵感",
  "2": "第一性拆解",
  "3": "自适应发散",
  "4": "提交",
};

export function ConfirmNextDialog({ open, targetStage, affectedStages, onConfirm, onCancel }: Props) {
  if (!open || targetStage === null) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="confirm-next-dialog">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-lg font-semibold mb-3">重新进入 {STAGE_LABELS[targetStage]}</h2>
        <p className="text-sm text-gray-600 mb-4">
          当前 {STAGE_LABELS[targetStage]} 之后已有已生成的内容:
        </p>
        <ul className="text-sm text-gray-700 mb-4 list-disc list-inside">
          {affectedStages.map((s) => (
            <li key={s}>第 {s} 阶段:{STAGE_LABELS[s]}</li>
          ))}
        </ul>
        <p className="text-sm text-gray-600 mb-4">
          点击「确认」将清空这些阶段的已有内容,并重新执行当前阶段操作。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200"
            onClick={onCancel}
            data-testid="confirm-next-cancel"
          >
            取消
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={onConfirm}
            data-testid="confirm-next-confirm"
          >
            确认清空并继续
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmNextDialog } from "@/components/wizard/divergence_v2/ConfirmNextDialog";

describe("ConfirmNextDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ConfirmNextDialog open={false} targetStage={null} affectedStages={[]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders affected stages when open", () => {
    render(<ConfirmNextDialog open={true} targetStage="2" affectedStages={["3", "4"]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/第一性拆解/)).toBeInTheDocument();
    expect(screen.getByText(/自适应发散/)).toBeInTheDocument();
    expect(screen.getByText(/提交/)).toBeInTheDocument();
  });

  it("cancel button calls onCancel", () => {
    const onCancel = jest.fn();
    render(<ConfirmNextDialog open={true} targetStage="2" affectedStages={["3"]} onConfirm={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("confirm-next-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("confirm button calls onConfirm", () => {
    const onConfirm = jest.fn();
    render(<ConfirmNextDialog open={true} targetStage="2" affectedStages={["3"]} onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId("confirm-next-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- ConfirmNextDialog
```

Expected: 4 passed。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/ConfirmNextDialog.tsx frontend/src/test/wizard/divergence_v2/ConfirmNextDialog.test.tsx
git commit -m "feat(divergence): add ConfirmNextDialog (二次确认通用组件)"
```

---

## Task 18: S2DecomposeStep

**Files:**
- Create: `frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx`
- Create: `frontend/src/test/wizard/divergence_v2/S2DecomposeStep.test.tsx`

- [ ] **Step 1: 实现 S2 组件**

```tsx
import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Unit } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  causalMap: string;
  topLevelSummary: string;
  loading: boolean;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  ontology: "世界构成 (Ontology)",
  energetics: "能量体系 (Energetics)",
  power_structure: "社会控制 (Power Structure)",
  protagonist_engine: "主角机制 (Protagonist Engine)",
  narrative_physics: "叙事动力 (Narrative Physics)",
};

export default function S2DecomposeStep({
  dimensions, causalMap, topLevelSummary, loading, followUpLoadingUnitId,
  onFollowUp, onPrev, onNext,
}: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          Stage 2 · 第一性拆解 · 5 维度
        </header>

        {causalMap && (
          <pre className="bg-surface-container border border-outline-variant rounded-lg p-3 text-xs text-primary whitespace-pre-wrap" data-testid="causal-map">
            {causalMap}
          </pre>
        )}

        {dimensions.map((dim) => (
          <DimensionBlock
            key={dim.dimension}
            dimension={dim}
            followUpLoadingUnitId={followUpLoadingUnitId}
            onFollowUp={onFollowUp}
          />
        ))}

        {topLevelSummary && (
          <div className="border-t border-outline-variant pt-3" data-testid="top-level-summary">
            <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider mb-1">
              总览
            </h3>
            <p className="text-sm text-primary">{topLevelSummary}</p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <SecondaryButton label="上一步:输入" icon="arrow_back" onClick={onPrev} />
        <PrimaryButton
          label={loading ? "拆解中…" : "下一步:发散 →"}
          icon={loading ? undefined : "arrow_forward"}
          loading={loading}
          onClick={onNext}
        />
      </footer>
    </div>
  );
}

function DimensionBlock({
  dimension, followUpLoadingUnitId, onFollowUp,
}: {
  dimension: DimensionDecomposition;
  followUpLoadingUnitId: string | null;
  onFollowUp: (unitId: string, userQuestion: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [followUpUnitId, setFollowUpUnitId] = useState<string | null>(null);
  const [followUpText, setFollowUpText] = useState("");

  return (
    <section className="bg-surface-container-low border border-outline-variant rounded-lg p-3" data-testid={`dimension-${dimension.dimension}`}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          {DIMENSION_LABELS[dimension.dimension] ?? dimension.dimension}
        </h3>
      </button>
      {dimension.insight && (
        <p className="text-xs text-on-surface-variant mt-1 ml-5">
          核心洞察:{dimension.insight}
        </p>
      )}
      {!collapsed && (
        <div className="space-y-2 mt-2">
          {dimension.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              loading={followUpLoadingUnitId === u.id}
              followUpUnitId={followUpUnitId}
              followUpText={followUpText}
              setFollowUpUnitId={setFollowUpUnitId}
              setFollowUpText={setFollowUpText}
              onSubmit={() => {
                onFollowUp(u.id, followUpText.trim() || null);
                setFollowUpUnitId(null);
                setFollowUpText("");
              }}
              onCancel={() => {
                setFollowUpUnitId(null);
                setFollowUpText("");
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnitCard({
  unit, loading, followUpUnitId, followUpText,
  setFollowUpUnitId, setFollowUpText, onSubmit, onCancel,
}: {
  unit: Unit;
  loading: boolean;
  followUpUnitId: string | null;
  followUpText: string;
  setFollowUpUnitId: (id: string | null) => void;
  setFollowUpText: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const showDialog = followUpUnitId === unit.id;
  return (
    <div
      className={
        "bg-surface-container border border-outline-variant rounded-lg p-3 text-sm " +
        (loading ? "opacity-50" : "")
      }
      data-testid={`unit-${unit.id}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
            {unit.unit_name} [Unit #{unit.id}]
          </div>
          <div className="text-primary mt-1">{unit.description}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={unit.is_irreducible}
            onClick={() => setFollowUpUnitId(unit.id)}
            className={
              "px-3 py-1.5 rounded text-sm " +
              (unit.is_irreducible
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-primary-container/15 text-primary-container hover:bg-primary-container/25")
            }
            data-testid={`follow-up-${unit.id}`}
          >
            {unit.is_irreducible ? "已不可再分" : (unit.follow_up_count > 0 ? `已追问 ${unit.follow_up_count} 次` : "追问")}
          </button>
        </div>
      </div>

      {showDialog && (
        <div className="mt-3 p-3 border border-primary-container/30 rounded-lg bg-primary-container/5 space-y-2">
          <textarea
            placeholder="(留空使用默认追问)"
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            rows={2}
            data-testid={`follow-up-input-${unit.id}`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 rounded bg-gray-100 text-sm"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
            >
              确认追问
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import S2DecomposeStep from "@/components/wizard/divergence_v2/S2DecomposeStep";
import type { DimensionDecomposition } from "@/components/wizard/divergence_v2/types";

const MOCK_DIMENSIONS: DimensionDecomposition[] = [
  {
    dimension: "ontology",
    insight: "本土天道 vs 异域天道的殖民",
    units: [
      { id: "u1", dimension: "ontology", unit_name: "灵窍", description: "灵窍是接口...", follow_up_count: 0, is_irreducible: false },
      { id: "u2", dimension: "ontology", unit_name: "本源", description: "本源是...", follow_up_count: 1, is_irreducible: true },
    ],
    candidates: [],
    dimension_status: "decomposed",
  },
  {
    dimension: "energetics",
    insight: "修炼本质是编译",
    units: [{ id: "u3", dimension: "energetics", unit_name: "修行", description: "...", follow_up_count: 0, is_irreducible: false }],
    candidates: [],
    dimension_status: "decomposed",
  },
];

describe("S2DecomposeStep", () => {
  it("renders all dimension blocks by id", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId("dimension-ontology")).toBeInTheDocument();
    expect(screen.getByTestId("dimension-energetics")).toBeInTheDocument();
  });

  it("renders causal_map and top_level_summary", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="因果图 A→B" topLevelSummary="总览文本" loading={false} followUpLoadingUnitId={null} onFollowUp={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId("causal-map")).toHaveTextContent("因果图 A→B");
    expect(screen.getByTestId("top-level-summary")).toHaveTextContent("总览文本");
  });

  it("irreducible unit follow-up button is disabled", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId("follow-up-u1")).not.toBeDisabled();
    expect(screen.getByTestId("follow-up-u2")).toBeDisabled();
  });

  it("clicking follow-up shows dialog; submitting with text calls onFollowUp", () => {
    const onFollowUp = jest.fn();
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={onFollowUp} onPrev={jest.fn()} onNext={jest.fn()} />);
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    const input = screen.getByTestId("follow-up-input-u1");
    fireEvent.change(input, { target: { value: "再深入" } });
    fireEvent.click(screen.getByText("确认追问"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", "再深入");
  });

  it("submitting empty follow-up calls onFollowUp with null", () => {
    const onFollowUp = jest.fn();
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={onFollowUp} onPrev={jest.fn()} onNext={jest.fn()} />);
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.click(screen.getByText("确认追问"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", null);
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- S2DecomposeStep
```

Expected: 5 passed。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx frontend/src/test/wizard/divergence_v2/S2DecomposeStep.test.tsx
git commit -m "feat(divergence): S2DecomposeStep (5 维度 + insight + 追问 + irreducible disabled)"
```

---

## Task 19: S3DivergeStep

**Files:**
- Create: `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx`
- Create: `frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx`

- [ ] **Step 1: 实现 S3 组件**

```tsx
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { DimensionDecomposition, Operator, UnitCandidate } from "./types";

interface Props {
  dimensions: DimensionDecomposition[];
  loading: boolean;
  onRegenerateUnit: (unitId: string) => void;
  onSelectCandidate: (unitId: string, candidateIndex: number) => void;
  onRegenerateAll: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const OPERATOR_LABELS: Record<Operator, string> = {
  distort: "扭曲",
  break: "打破",
  blend: "融合",
  chain: "组合链",
};

export default function S3DivergeStep({
  dimensions, loading, onRegenerateUnit, onSelectCandidate, onRegenerateAll, onPrev, onNext,
}: Props) {
  const allFailed = dimensions.length > 0 && dimensions.every((d) =>
    d.units.length > 0 && d.units.every((u) => !d.candidates.some((c) => c.unit_id === u.id))
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between">
          <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
            Stage 3 · 自适应发散
          </header>
          <SecondaryButton label="全部重新生成" icon="refresh" size="sm" onClick={onRegenerateAll} />
        </div>

        {allFailed && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm" data-testid="all-failed-banner">
            所有 unit 发散失败,请点击「全部重新生成」重试。
          </div>
        )}

        {dimensions.map((dim) => (
          <section key={dim.dimension} className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2" data-testid={`diverge-dim-${dim.dimension}`}>
            <h3 className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
              {dim.dimension}
            </h3>
            {dim.units.map((u) => {
              const unitCandidates = dim.candidates
                .filter((c) => c.unit_id === u.id)
                .sort((a, b) => a.selection_rank - b.selection_rank);
              const unitFailed = unitCandidates.length === 0;
              const selectedIdx = unitCandidates.findIndex((c) => c.selection_rank === 0);

              return (
                <div key={u.id} className="bg-surface-container border border-outline-variant rounded-lg p-3 text-sm space-y-2" data-testid={`diverge-unit-${u.id}`}>
                  <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
                    {u.unit_name} [Unit #{u.id}]
                  </div>
                  {unitFailed ? (
                    <div className="space-y-2">
                      <div className="text-warning bg-warning-container/20 border border-warning/30 rounded p-2 text-sm">
                        该单元暂不可用 (发散失败)
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegenerateUnit(u.id)}
                        className="px-3 py-1.5 rounded text-sm bg-primary-container/15 text-primary-container hover:bg-primary-container/25"
                      >
                        重新生成该单元
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-on-surface-variant">
                        算子: {OPERATOR_LABELS[unitCandidates[selectedIdx]?.main_operator ?? "distort"]}
                        {unitCandidates[selectedIdx]?.aux_operator && ` · ${OPERATOR_LABELS[unitCandidates[selectedIdx]!.aux_operator!]}`}
                      </div>
                      <div className="space-y-1">
                        {unitCandidates.map((c) => (
                          <CandidateRow
                            key={c.id}
                            candidate={c}
                            selected={c.selection_rank === 0}
                            onSelect={() => onSelectCandidate(u.id, c.selection_rank)}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRegenerateUnit(u.id)}
                        className="px-3 py-1.5 rounded text-sm bg-primary-container/15 text-primary-container hover:bg-primary-container/25"
                      >
                        重新生成该单元
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <SecondaryButton label="上一步:拆解" icon="arrow_back" onClick={onPrev} />
        <PrimaryButton
          label={loading ? "发散中…" : "下一步:提交 →"}
          icon={loading ? undefined : "arrow_forward"}
          loading={loading}
          onClick={onNext}
        />
      </footer>
    </div>
  );
}

function CandidateRow({
  candidate, selected, onSelect,
}: {
  candidate: UnitCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={`candidate-${candidate.id}`}>
      <input type="radio" checked={selected} onChange={onSelect} className="mt-1 accent-primary-container" />
      <div className="flex-1">
        <div className="text-primary text-sm">{candidate.description}</div>
        <div className="text-xs text-on-surface-variant mt-1">
          连锁推演:{candidate.chain_reaction}
        </div>
      </div>
    </label>
  );
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import S3DivergeStep from "@/components/wizard/divergence_v2/S3DivergeStep";
import type { DimensionDecomposition } from "@/components/wizard/divergence_v2/types";

const MOCK: DimensionDecomposition[] = [
  {
    dimension: "ontology",
    insight: "",
    units: [
      { id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false },
    ],
    candidates: [
      { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "候选 A 描述", chain_reaction: "连锁 A", main_operator: "distort", aux_operator: null, selection_rank: 0 },
      { id: "c2", unit_id: "u1", unit_name: "灵窍", description: "候选 B 描述", chain_reaction: "连锁 B", main_operator: "break", aux_operator: "blend", selection_rank: 1 },
    ],
    dimension_status: "diverged",
  },
  {
    dimension: "energetics",
    insight: "",
    units: [{ id: "u2", dimension: "energetics", unit_name: "修行", description: "d", follow_up_count: 0, is_irreducible: false }],
    candidates: [],
    dimension_status: "divergence_failed",
  },
];

describe("S3DivergeStep", () => {
  it("renders chain_reaction text for each candidate", () => {
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={jest.fn()} onSelectCandidate={jest.fn()} onRegenerateAll={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByText(/连锁 A/)).toBeInTheDocument();
    expect(screen.getByText(/连锁 B/)).toBeInTheDocument();
  });

  it("selecting a different candidate calls onSelectCandidate with the candidate's rank", () => {
    const onSelect = jest.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={jest.fn()} onSelectCandidate={onSelect} onRegenerateAll={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    fireEvent.click(screen.getByTestId("candidate-c2"));
    expect(onSelect).toHaveBeenCalledWith("u1", 1);
  });

  it("failed unit shows '该单元暂不可用' + regen button", () => {
    const onRegen = jest.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={onRegen} onSelectCandidate={jest.fn()} onRegenerateAll={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByText(/该单元暂不可用/)).toBeInTheDocument();
    const buttons = screen.getAllByText("重新生成该单元");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onRegen).toHaveBeenCalledWith("u2");
  });

  it("renders 'all failed' banner when every unit failed", () => {
    const allFailed: DimensionDecomposition[] = MOCK.map((d) => ({ ...d, candidates: [] }));
    render(<S3DivergeStep dimensions={allFailed} loading={false} onRegenerateUnit={jest.fn()} onSelectCandidate={jest.fn()} onRegenerateAll={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId("all-failed-banner")).toBeInTheDocument();
  });

  it("'全部重新生成' calls onRegenerateAll", () => {
    const onAll = jest.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={jest.fn()} onSelectCandidate={jest.fn()} onRegenerateAll={onAll} onPrev={jest.fn()} onNext={jest.fn()} />);
    fireEvent.click(screen.getByText("全部重新生成"));
    expect(onAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- S3DivergeStep
```

Expected: 5 passed。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx
git commit -m "feat(divergence): S3DivergeStep (per-unit 自适应 + radio + chain_reaction + 失败降级)"
```

---

## Task 20: S4CommitStep

**Files:**
- Create: `frontend/src/components/wizard/divergence_v2/S4CommitStep.tsx`
- Create: `frontend/src/test/wizard/divergence_v2/S4CommitStep.test.tsx`

- [ ] **Step 1: 实现 S4 组件**

```tsx
import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/ds";
import type { CommittedConcept, NoveltyScores } from "./types";

interface Props {
  committedConcept: CommittedConcept | null;
  noveltyScores: NoveltyScores | null;
  loading: boolean;
  onEditConcept: (fields: Partial<CommittedConcept>) => void;
  onRegenerateCommit: () => void;
  onRegenerateAllDivergence: () => void;
  onAdvance: () => void;
}

const FIELDS = [
  { key: "one_line" as const, label: "一句话", multiline: false },
  { key: "expanded" as const, label: "扩展", multiline: true },
  { key: "core_tension" as const, label: "核心张力", multiline: true },
  { key: "tone" as const, label: "基调", multiline: false },
  { key: "logline" as const, label: "Logline", multiline: true },
];

export default function S4CommitStep({
  committedConcept, noveltyScores, loading, onEditConcept, onRegenerateCommit, onRegenerateAllDivergence, onAdvance,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<CommittedConcept>>({});
  const [confirmRegen, setConfirmRegen] = useState(false);

  if (committedConcept === null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
          尚未合成 concept,点「下一步」将开始 LLM 合成
        </div>
        <footer className="flex items-center justify-end px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
          <PrimaryButton
            label={loading ? "合成中…" : "下一步:进入概念DNA →"}
            icon={loading ? undefined : "arrow_forward"}
            loading={loading}
            onClick={onAdvance}
          />
        </footer>
      </div>
    );
  }

  function startEdit() {
    setDraft({ ...committedConcept! });
    setEditing(true);
  }

  function saveEdit() {
    onEditConcept(draft);
    setEditing(false);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <header className="font-mono text-primary-container text-[10px] uppercase tracking-wider">
          Stage 4 · 提交
        </header>

        {!editing ? (
          <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="text-xs text-on-surface-variant">{f.label}</div>
                <div className="text-primary mt-1 whitespace-pre-wrap" data-testid={`committed-${f.key}`}>
                  {(committedConcept as any)[f.key]}
                </div>
              </div>
            ))}
            {committedConcept.edited_by_user && (
              <div className="text-xs text-warning">用户已编辑</div>
            )}
            {noveltyScores && (
              <div className="border-t border-outline-variant pt-2 mt-2 text-xs text-on-surface-variant" data-testid="novelty-scores">
                新颖度评分 composite: {noveltyScores.composite} {noveltyScores.grade}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-on-surface-variant block mb-1">{f.label}</label>
                <textarea
                  rows={f.multiline ? 4 : 1}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
                  value={(draft as any)[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  data-testid={`edit-${f.key}`}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <SecondaryButton label="取消编辑" onClick={() => setEditing(false)} />
              <PrimaryButton label="保存编辑" icon="save" onClick={saveEdit} />
            </div>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
        <div className="flex gap-2">
          {!editing && <SecondaryButton label="编辑" icon="edit" onClick={startEdit} />}
          <SecondaryButton
            label="重新生成"
            icon="refresh"
            onClick={() => setConfirmRegen(true)}
          />
          <SecondaryButton
            label="全部重新生成"
            icon="restart_alt"
            onClick={onRegenerateAllDivergence}
          />
        </div>
        <PrimaryButton
          label={loading ? "提交中…" : "下一步:进入概念DNA →"}
          icon={loading ? undefined : "arrow_forward"}
          loading={loading}
          onClick={onAdvance}
          data-testid="advance-button"
        />
      </footer>

      {confirmRegen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="regen-confirm-dialog">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold mb-3">重新生成 concept?</h2>
            <p className="text-sm text-gray-600 mb-4">
              当前 concept 包含用户编辑或之前生成结果,重新生成将覆盖。是否继续?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-100"
                onClick={() => setConfirmRegen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={() => { setConfirmRegen(false); onRegenerateCommit(); }}
              >
                确认重新生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import S4CommitStep from "@/components/wizard/divergence_v2/S4CommitStep";
import type { CommittedConcept, NoveltyScores } from "@/components/wizard/divergence_v2/types";

const MOCK_CONCEPT: CommittedConcept = {
  one_line: "一句话",
  expanded: "扩展",
  core_tension: "张力",
  tone: "暗黑",
  logline: "logline",
  edited_by_user: false,
};

const MOCK_SCORES: NoveltyScores = {
  market_saturation: 0.6, trope_similarity: 0.5, contradiction_depth: 0.7,
  discussion_potential: 0.6, composite: 60, grade: "B+",
};

describe("S4CommitStep", () => {
  it("shows empty state when committedConcept is null", () => {
    render(<S4CommitStep committedConcept={null} noveltyScores={null} loading={false} onEditConcept={jest.fn()} onRegenerateCommit={jest.fn()} onRegenerateAllDivergence={jest.fn()} onAdvance={jest.fn()} />);
    expect(screen.getByText(/尚未合成 concept/)).toBeInTheDocument();
  });

  it("renders all 5 fields and novelty grade", () => {
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={MOCK_SCORES} loading={false} onEditConcept={jest.fn()} onRegenerateCommit={jest.fn()} onRegenerateAllDivergence={jest.fn()} onAdvance={jest.fn()} />);
    expect(screen.getByTestId("committed-one_line")).toHaveTextContent("一句话");
    expect(screen.getByTestId("novelty-scores")).toHaveTextContent(/composite: 60 B\+/);
  });

  it("edit → save calls onEditConcept", () => {
    const onEdit = jest.fn();
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} loading={false} onEditConcept={onEdit} onRegenerateCommit={jest.fn()} onRegenerateAllDivergence={jest.fn()} onAdvance={jest.fn()} />);
    fireEvent.click(screen.getByText("编辑"));
    const oneLine = screen.getByTestId("edit-one_line");
    fireEvent.change(oneLine, { target: { value: "新的一句话" } });
    fireEvent.click(screen.getByText("保存编辑"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ one_line: "新的一句话" }));
  });

  it("'重新生成' triggers confirm dialog", () => {
    const onRegen = jest.fn();
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} loading={false} onEditConcept={jest.fn()} onRegenerateCommit={onRegen} onRegenerateAllDivergence={jest.fn()} onAdvance={jest.fn()} />);
    fireEvent.click(screen.getByText("重新生成"));
    expect(screen.getByTestId("regen-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("确认重新生成"));
    expect(onRegen).toHaveBeenCalled();
  });

  it("'下一步' calls onAdvance", () => {
    const onAdvance = jest.fn();
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} loading={false} onEditConcept={jest.fn()} onRegenerateCommit={jest.fn()} onRegenerateAllDivergence={jest.fn()} onAdvance={onAdvance} />);
    fireEvent.click(screen.getByTestId("advance-button"));
    expect(onAdvance).toHaveBeenCalled();
  });

  it("edited_by_user=true shows '用户已编辑' label", () => {
    render(<S4CommitStep committedConcept={{ ...MOCK_CONCEPT, edited_by_user: true }} noveltyScores={null} loading={false} onEditConcept={jest.fn()} onRegenerateCommit={jest.fn()} onRegenerateAllDivergence={jest.fn()} onAdvance={jest.fn()} />);
    expect(screen.getByText("用户已编辑")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- S4CommitStep
```

Expected: 6 passed。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S4CommitStep.tsx frontend/src/test/wizard/divergence_v2/S4CommitStep.test.tsx
git commit -m "feat(divergence): S4CommitStep (5 字段展示 + 编辑 + 重新生成二次确认 + advance)"
```

---

## Task 21: S1InputStep 适配(几乎不改)

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx`(只 emit intent,不再调 API)
- Modify: `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx`(去掉 API mock 期望)

- [ ] **Step 1: 改造 S1InputStep**

把 `handleSubmit` 的 `api.postThreeBDiverge` 调用去掉,只 emit intent:

```tsx
async function handleSubmit() {
  if (!valid || submitting) return;
  setSubmitting(true);
  try {
    const intent: RawIntent = {
      prompt,
      genre_primary: genrePrimary,
      genre_secondary: genreSecondary === NO_SECONDARY ? null : genreSecondary,
    };
    // 父级 orchestrator 负责触发 /decompose + /diverge
    onSubmitted(intent);
  } finally {
    setSubmitting(false);
  }
}
```

Props 类型从 `onSubmitted: (intent: RawIntent, resp: DivergeResponse) => void` 改为 `onSubmitted: (intent: RawIntent) => void`。

- [ ] **Step 2: 改 S1InputStep 测试**

修改 `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx`:
- 删除 `jest.mock("@/api/client")` 中的 `postThreeBDiverge` mock
- `handleSubmit` 期望改为 `expect(onSubmitted).toHaveBeenCalledWith({ prompt: ..., genre_primary: ..., genre_secondary: ... })`

- [ ] **Step 3: 跑测试**

```bash
cd frontend && npm test -- S1InputStep
```

Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S1InputStep.tsx frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx
git commit -m "refactor(divergence): S1InputStep emit intent only (orchestrator owns API)"
```

---

## Task 22: CreativeDivergenceStep orchestrator + api/client

**Files:**
- Modify: `frontend/src/components/wizard/CreativeDivergenceStep.tsx`(完整重写为 4 阶段 orchestrator)
- Modify: `frontend/src/api/client.ts`(替换 3B methods 为 10 个新端点 + 新增 payload 类型)
- Modify: `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`(重写)

- [ ] **Step 1: 重写 api/client.ts 的 3B section**

先替换 `frontend/src/api/client.ts` 第 1-9 行的 import 为新类型:

```typescript
import type { Genre } from "../hooks/useGenres";
import type {
  CommittedConcept,
  DimensionDecomposition,
  NoveltyScores,
  RawIntent as ThreeBRawIntent,
  Unit,
  UnitCandidate,
} from "../components/wizard/divergence_v2/types";
```

然后替换第 1879-1933 行的 3B methods 为:

```typescript
  // Creative divergence v2 — 4-stage flow (decompose / follow_up / diverge /
  // regenerate_unit / select_unit / commit / edit_concept / advance / state)
  postThreeBDecompose: (projectId: string, body: ThreeBRawIntent) =>
    request<DecomposeResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/decompose`,
      body,
    ),

  postThreeBFollowUp: (
    projectId: string,
    body: { unit_id: string; user_question: string | null },
  ) =>
    request<{ unit: Unit }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/follow-up-unit`,
      body,
    ),

  postThreeBDiverge: (projectId: string) =>
    request<DivergeResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/diverge`,
      {},
    ),

  postThreeBRegenerateUnit: (
    projectId: string,
    body: { unit_id: string },
  ) =>
    request<{ candidates: UnitCandidate[]; dimension: DimensionDecomposition }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/regenerate-unit`,
      body,
    ),

  postThreeBSelectUnit: (
    projectId: string,
    body: { unit_id: string; candidate_index: number },
  ) =>
    request<{ dimension: DimensionDecomposition }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/select-unit`,
      body,
    ),

  postThreeBCommit: (projectId: string) =>
    request<CommitResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/commit`,
      {},
    ),

  postThreeBEditConcept: (
    projectId: string,
    body: Partial<CommittedConcept>,
  ) =>
    request<{ committed_concept: CommittedConcept }>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/edit-concept`,
      body,
    ),

  postThreeBAdvance: (projectId: string) =>
    request<AdvanceResponse>(
      "POST",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/advance`,
      {},
    ),

  getThreeBState: (projectId: string) =>
    request<ThreeBStatePayload>(
      "GET",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/state`,
    ),

  deleteThreeBState: (projectId: string) =>
    request<{ ok: boolean }>(
      "DELETE",
      `/v1/projects/${encodeURIComponent(projectId)}/creative/diverge/three-b/state`,
    ),
};

// Response payload types
export interface DecomposeResponse {
  dimensions: DimensionDecomposition[];
  causal_map: string;
  top_level_summary: string;
}

export interface DivergeResponse {
  dimensions: DimensionDecomposition[];
}

export interface CommitResponse {
  committed_concept: CommittedConcept;
  novelty_scores: NoveltyScores;
}

export interface AdvanceResponse {
  committed_at: string;
}
```

- [ ] **Step 2: 重写 CreativeDivergenceStep orchestrator**

```tsx
import { useState, useEffect } from "react";
import S1InputStep from "./divergence_v2/S1InputStep";
import S2DecomposeStep from "./divergence_v2/S2DecomposeStep";
import S3DivergeStep from "./divergence_v2/S3DivergeStep";
import S4CommitStep from "./divergence_v2/S4CommitStep";
import StepIndicator from "./divergence_v2/StepIndicator";
import { ConfirmNextDialog } from "./divergence_v2/ConfirmNextDialog";
import { GhostButton } from "@/components/ds";
import { hasDownstreamData, useThreeBDivergence } from "./divergence_v2/useThreeBDivergence";
import type { RawIntent, SubStage } from "./divergence_v2/types";

interface Props {
  projectId: string;
  onAdvanceSuccess?: () => void;
}

export default function CreativeDivergenceStep({
  projectId, onAdvanceSuccess,
}: Props) {
  const {
    state, decompose, followUp, diverge, regenerateUnit, selectCandidate,
    commit, editConcept, advance, jumpTo, reset,
  } = useThreeBDivergence(projectId);

  const [confirmNext, setConfirmNext] = useState<{ target: SubStage; affected: SubStage[] } | null>(null);
  const [showUpgradeToast, setShowUpgradeToast] = useState(false);

  // v1 升级后空态 toast(组件级,首次进入时检查)
  useEffect(() => {
    if (state.rawIntent === null && state.dimensions.length === 0 && state.completedSubStages.length === 0) {
      setShowUpgradeToast(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 进入 S2 时若 dimensions 为空自动跑 decompose
  useEffect(() => {
    if (state.currentSubStage === "2" && state.dimensions.length === 0 && state.rawIntent && !state.loading) {
      decompose(state.rawIntent);
    }
  }, [state.currentSubStage, state.dimensions.length, state.rawIntent, state.loading, decompose]);

  // 「下一步」按钮触发 REQUEST_NEXT:检查下游,有则 dialog
  function requestNext(target: SubStage) {
    if (hasDownstreamData(state, target)) {
      const affected: SubStage[] = [];
      if (target === "2") affected.push("2", "3", "4");
      else if (target === "3") affected.push("3", "4");
      else if (target === "4") affected.push("4");
      setConfirmNext({ target, affected });
    } else {
      jumpTo(target);
      if (target === "3") diverge();
      if (target === "4" && state.committedConcept === null) commit();
    }
  }

  function confirmAndExecute() {
    if (!confirmNext) return;
    const target = confirmNext.target;
    setConfirmNext(null);
    jumpTo(target);
    if (target === "2") {
      if (state.rawIntent) decompose(state.rawIntent);
    } else if (target === "3") {
      diverge();
    } else if (target === "4") {
      commit();
    }
  }

  function handleS1Submit(intent: RawIntent) {
    jumpTo("2");
    decompose(intent);
  }

  return (
    <div data-testid="creative-divergence-step" className="flex flex-col flex-1 min-h-0">
      <StepIndicator current={state.currentSubStage} completed={state.completedSubStages} onStageClick={jumpTo} />

      {showUpgradeToast && (
        <div className="bg-warning-container/20 border border-warning rounded-lg px-3 py-2 text-sm text-warning" data-testid="upgrade-toast">
          创意发散已升级到 4 阶段流程,旧版本已清除
        </div>
      )}

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {state.error && (
          <div className="p-3 bg-error-container/20 border border-error rounded-lg text-error text-sm">
            {state.error}
            <button type="button" className="ml-2 underline" onClick={() => location.reload()}>重试</button>
          </div>
        )}

        {state.currentSubStage === "1" && (
          <S1InputStep projectId={projectId} initial={state.rawIntent} onSubmitted={handleS1Submit} />
        )}

        {state.currentSubStage === "2" && (
          <S2DecomposeStep
            dimensions={state.dimensions}
            causalMap={state.causalMap}
            topLevelSummary={state.topLevelSummary}
            loading={state.loading}
            followUpLoadingUnitId={state.followUpLoadingUnitId}
            onFollowUp={followUp}
            onPrev={() => jumpTo("1")}
            onNext={() => requestNext("3")}
          />
        )}

        {state.currentSubStage === "3" && (
          <S3DivergeStep
            dimensions={state.dimensions}
            loading={state.loading}
            onRegenerateUnit={regenerateUnit}
            onSelectCandidate={selectCandidate}
            onRegenerateAll={diverge}
            onPrev={() => jumpTo("2")}
            onNext={() => requestNext("4")}
          />
        )}

        {state.currentSubStage === "4" && (
          <S4CommitStep
            committedConcept={state.committedConcept}
            noveltyScores={state.noveltyScores}
            loading={state.loading}
            onEditConcept={editConcept}
            onRegenerateCommit={commit}
            onRegenerateAllDivergence={() => { jumpTo("3"); diverge(); }}
            onAdvance={async () => {
              await advance();
              onAdvanceSuccess?.();
            }}
          />
        )}

        {(state.currentSubStage === "2" || state.currentSubStage === "3") && (
          <div className="flex justify-start">
            <GhostButton label="重新输入" size="sm" onClick={async () => { await reset(); jumpTo("1"); }} />
          </div>
        )}
      </div>

      <ConfirmNextDialog
        open={confirmNext !== null}
        targetStage={confirmNext?.target ?? null}
        affectedStages={confirmNext?.affected ?? []}
        onConfirm={confirmAndExecute}
        onCancel={() => setConfirmNext(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: 重写 CreativeDivergenceStep 测试**

修改 `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`(及 `CreativeDivergenceStep.nav.test.tsx` 如存在)以覆盖 4 阶段流程:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";

jest.mock("@/api/client");

describe("CreativeDivergenceStep (4 stages)", () => {
  it("renders StepIndicator with 4 stages", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-4")).toBeInTheDocument();
  });

  it("shows S1 by default", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByText(/灵感点子/)).toBeInTheDocument();
  });

  // 完整 case 列表:
  // - '下一步' on S2 with empty downstream advances directly
  // - '下一步' on S2 with downstream data opens ConfirmNextDialog
  // - ConfirmNextDialog 取消 → 留在 S2
  // - ConfirmNextDialog 确认 → 进入 S3 + 触发 diverge
  // - 进入 S2 自动触发 decompose(若 dimensions 为空)
  // - 上一步 / 重新输入按钮工作
});
```

完整测试代码由工程师按上述 cases 展开(参考旧 `CreativeDivergenceStep.test.tsx` 的 mock 模式 + `useThreeBDivergence.test.ts` 的 reducer 断言风格)。

- [ ] **Step 4: 跑测试**

```bash
cd frontend && npm test -- CreativeDivergenceStep
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/CreativeDivergenceStep.tsx frontend/src/api/client.ts frontend/src/test/wizard/CreativeDivergenceStep.test.tsx frontend/src/test/wizard/CreativeDivergenceStep.nav.test.tsx
git commit -m "feat(divergence): rewrite orchestrator + 10 new endpoints (4-stage flow)"
```

---

## Task 23: 删除旧文件(v1 → v2 清理)

**Files:**
- Delete: `frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx`
- Delete: `frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx`
- Delete: `frontend/src/test/wizard/divergence_v2/S2DivergenceStep.test.tsx`
- Delete: `frontend/src/test/wizard/divergence_v2/S3DeepenStep.test.tsx`
- (可选)Delete: `frontend/src/components/wizard/divergence/` 旧 Path B 目录

- [ ] **Step 1: 删除旧前端文件**

```bash
cd /Users/longsa/Codes/nebula
git rm frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx
git rm frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx
git rm frontend/src/test/wizard/divergence_v2/S2DivergenceStep.test.tsx
git rm frontend/src/test/wizard/divergence_v2/S3DeepenStep.test.tsx
```

- [ ] **Step 2: 检查旧 divergence/ 目录是否有引用**

```bash
grep -r "from.*wizard/divergence['\"]" /Users/longsa/Codes/nebula/frontend/src/ 2>/dev/null | head -20
```

如无引用,删除整个目录:
```bash
git rm -r frontend/src/components/wizard/divergence/ 2>/dev/null
```

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 全部通过(无引用旧类型)。

- [ ] **Step 4: 跑所有前端测试**

```bash
cd frontend && npm test
```

Expected: 全部通过。

- [ ] **Step 5: 跑后端测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_creative_os/test_three_b*.py tests/test_api/test_three_b_routes.py tests/test_prompts/test_three_b_yaml.py -x
```

Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula
git status
git commit -m "chore(divergence): remove v1 files (S2DivergenceStep, S3DeepenStep, old 3B tests)"
```

---

## Task 24: E2E + 最终验收

**Files:**(无新增代码,仅验证)

- [ ] **Step 1: 跑全部测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest tests/test_creative_os/ tests/test_api/test_three_b_routes.py tests/test_prompts/ -v
cd frontend && npm test
```

Expected: 后端 + 前端测试全部通过。

- [ ] **Step 2: 检查规格覆盖(14 项验收)**

```bash
cd /Users/longsa/Codes/nebula
grep -r "three_b_breaking\|three_b_bending\|three_b_blending" backend/prompts/creative/ 2>/dev/null
# Expected: 无输出
grep -r "three_b_breaking\|three_b_bending\|three_b_blending" backend/tests/ 2>/dev/null
# Expected: 无输出
```

逐一核对规格 §10 的 14 项验收:
1. 流程可走通 - engine 集成测试覆盖
2. 追问生效 - follow_up_unit 测试覆盖
3. 追问不可约化 - 422 测试覆盖
4. 发散失败降级 - asyncio.gather 失败测试覆盖
5. 编辑保存 - edit_concept 测试覆盖
6. advance 生效 - advance 测试覆盖
7. v1 迁移 - migration 测试覆盖
8. 跳回非破坏 - JUMP_TO_STAGE 测试覆盖
9. 下一步二次确认 - ConfirmNextDialog + reducer 测试覆盖
10. 旧算子 yaml 删除 - grep 验证
11. commit 拒绝 - 422 COMMIT_INSUFFICIENT 测试覆盖
12. 自适应引擎字段 - adaptive_diverge prompt + engine 测试覆盖
13. 测试通过 - 全部测试通过
14. 类型一致 - types.ts 与 dataclass 字段对照

- [ ] **Step 3: 手动 smoke test(可选)**

启动 backend + frontend:
```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
cd frontend && npm run dev
```

访问 http://localhost:5173,创建一个项目,跑通 4 阶段流程:
1. 输入灵感 + 选择类型 → S2
2. 拆解 → 5 维度渲染 + 追问按钮可用
3. 发散 → 候选 radio + chain_reaction 显示 + 失败 unit 红色 banner
4. 提交 → 5 字段展示 + 编辑 + 重新生成二次确认
5. 下一步 → advance 成功 + 概念 DNA 步骤

- [ ] **Step 4: 最终 commit(如有改动)**

```bash
cd /Users/longsa/Codes/nebula
git status
# 如有未提交改动:
git add -A
git commit -m "chore(divergence): final cleanup after E2E verification"
```

---

## 实施总结

完成所有 24 个 Task 后:
- 后端:`three_b_engine.py` 重写为 8 个 v2 方法(decompose / follow_up_unit / diverge / regenerate_unit / select_unit_candidate / commit / edit_concept / advance)+ v1→v2 迁移逻辑
- 前端:CreativeDivergenceStep 完整重写为 4 阶段 orchestrator + 3 个新步骤组件(S2DecomposeStep / S3DivergeStep / S4CommitStep)+ ConfirmNextDialog + JUMP_TO_STAGE reducer
- Prompt:删除 3 个旧算子 yaml,新增 4 个新 prompt yaml(decompose / follow_up / adaptive_diverge / commit 修改)
- 测试覆盖:14 项验收标准 + 8 engine 方法 + 10 端点 + 6 前端组件 + 1 orchestrator
