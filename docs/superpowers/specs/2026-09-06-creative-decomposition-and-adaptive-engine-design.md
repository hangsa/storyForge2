# 创意发散 4 阶段流程：拆解 + 自适应发散引擎

> **Status:** Draft for review
> **Author:** Claude (brainstorming with user)
> **Date:** 2026-09-06
> **Replaces:** `2026-09-04-creative-divergence-3b-redesign-design.md` (the 3-stage 3B plan shipped 2026-09-05)

---

## 1. 目标与非目标

### 1.1 目标

将 Wizard 「创意发散」步骤从 3 阶段重写为 4 阶段流程:

```
输入 → 拆解 → 自适应发散 → 提交
```

具体:

1. **新增「拆解」阶段**(Stage 2):按 `docs/design/创意分解.md` 的第一性原理方法论,把用户灵感拆解为 5 个固定维度(世界构成 / 能量体系 / 社会控制 / 主角机制 / 叙事动力),每维度 3-5 个「基本单元」;支持对任一基本单元「追问」(原地替换其 `description`)。
2. **新增「自适应发散引擎」**:替换旧 3B 打破/扭曲/融合三算子。引擎对每个 (维度×单元) 对独立产出 2 个候选,**输出格式与输入格式一致**(即候选也是 Unit-shaped),用户默认选第一个,可切换。
3. **新增「提交」阶段**(Stage 4):基于所有选定的维度-单元,LLM 合成 `concept_and_dna.json`(输出格式同旧 `three_b_commit`:one_line / expanded / core_tension / tone / logline)。用户可编辑编辑版本,保存后需「应用」才写入 `concept_and_dna.json` 让下游 stage 看到。
4. **状态文件 schema 升级到 v2**,带 v1→v2 迁移逻辑(保留旧 committed 项目,但强制重走新流程)。

### 1.2 非目标

- 不修改 `concept_and_dna.json` 的下游消费者(`stage2_world_char.py` 等只读 `story_dna` 与 `concept`,字段语义不变)
- 不重写 Prompt Plaza / LLM Config / 状态机外部设施
- 不修改旧 `creative_divergence.json` / `creative-divergence/*` Path B 接口(继续走 deprecation header)
- 不实现追问历史的撤销/版本回滚(只保留 `follow_up_count` 计数)

---

## 2. 背景与动机

### 2.1 现有实现回顾

`2026-09-04-creative-divergence-3b-redesign-design.md` 的 plan(`docs/superpowers/plans/2026-09-05-creative-divergence-3b-rewrite.md`)于 2026-09-05 部署到 `nebula` 分支,实现了 3 阶段流程:

| 阶段 | 操作 | 后端方法 | 状态 |
|---|---|---|---|
| Stage 1 输入 | prompt + genres | `DivergeRequest` | ✓ |
| Stage 2 3B 发散 | 3 算子 `asyncio.gather` | `ThreeBEngine.diverge` | ✓ |
| Stage 3 深化提交 | 选不同算子二次深化 + commit | `ThreeBEngine.deepen/commit` | ✓ |

三阶段的问题:用户缺乏「明确理解自己的灵感」的过程,直接进入算子发散,得到的候选虽多但与用户原始意图的「对齐」不稳定。

### 2.2 新流程的核心改进

新流程强制用户先经历一次「第一性拆解」,让用户**清晰知道自己的灵感包含哪些可操作的维度与单元**;然后在发散阶段,**按单元**而非按算子应用自适应引擎,候选与用户输入同构(都是 Unit-shaped),易于理解和对比;最后由用户**显式选定**每个维度的某个版本,提交时 LLM 看到的是「用户已经选择过的」,合成的 concept 与用户原始意图对齐度更高。

### 2.3 关键设计决策(从 brainstorming 阶段收集)

| 决策 | 选择 | 原因 |
|---|---|---|
| 维度体系 | **固定 5 维度 + 网文子域** | 5 大维度枚举化(可测试/可渲染),unit_name 由 LLM 根据题材决定(灵活) |
| 追问语义 | **原地替换 description** | 简单可逆,无需版本树;追问失败只丢当前 unit |
| 引擎粒度 | **每维度 1 次 LLM 调用**(共 5 次,`asyncio.gather`) | LLM 看到同维度上下文,避免冲突;总耗时 ≈ 1 次 LLM 时长 |
| 提交合成 | **LLM 合成** | 复用 `three_b_commit` 思路,保留「叙事粘合」 |
| 编辑后写盘 | **保存仅写 state,「应用」才写 concept_and_dna.json** | 让用户显式确认,避免下游读到未确认版本 |
| 状态迁移 | **schema_version=2 + 显式迁移** | 旧 committed 项目保留但强制重走,边界清晰 |
| 追问按钮空字符串 | **直接调用 follow-up prompt,无引导文案** | 简化 UX |
| 旧算子 yaml | **删除** three_b_breaking/bending/blending.yaml | 用户明确要求清除 |

---

## 3. 架构概览

### 3.1 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1 输入                                                    │
│  S1InputStep: prompt + genre_primary + genre_secondary           │
│       │                                                          │
│       ▼ POST /decompose                                          │
│  ThreeBEngine.decompose (1 次 LLM 调用)                          │
│       │                                                          │
│       ▼ 返回 5 dimensions × N units                              │
│  写 state.decompose_completed_at                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 2 拆解                                                    │
│  S2DecomposeStep: 展示 5 维度单元,每 unit 追问按钮               │
│       │                                                          │
│       ▼ POST /follow-up {unit_id, user_question?}                │
│  ThreeBEngine.follow_up_unit (1 次 LLM 调用,原地替换 description)│
│       │                                                          │
│       ▼ 用户点「下一步:发散」                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3 发散                                                    │
│  S3DivergeStep: 用户点「开始发散」                                │
│       │                                                          │
│       ▼ POST /diverge                                            │
│  ThreeBEngine.diverge_per_dimension (5 次 LLM 调用,asyncio.gather)│
│       │ 单维度失败 → dimension_status='divergence_failed'        │
│       ▼ 返回每单元 2 候选,默认 selected_index=0                  │
│  用户可:radio 切换候选 / POST /select-unit                       │
│       │                                                          │
│       ▼ 用户点「下一步:提交」                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4 提交                                                    │
│  S4CommitStep: 用户点「开始合成」                                 │
│       │                                                          │
│       ▼ POST /commit                                            │
│  ThreeBEngine.commit (1 次 LLM 调用,合成 5 字段)                 │
│       │ 写 state.committed_concept + concept_and_dna.json         │
│       │         + creative_divergence.json + 算 novelty_scores   │
│       ▼ 用户可:「编辑」→ POST /edit-concept                       │
│       │                                                          │
│       ▼ 用户点「应用」→ POST /apply-concept                       │
│       │ 写 concept_and_dna.json(用 edited version),              │
│       │ 更新 committed_concept.applied_at                        │
│       ▼ 用户点「下一步:概念DNA」                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 总 LLM 调用次数

| 阶段 | 每次操作 | 最坏情况 | 说明 |
|---|---|---|---|
| 拆解 | 1 | 1 | 必跑 |
| 追问 | 1/次 | 用户主导 | 0~N 次,每次原地替换 |
| 发散 | 5 | 5(并行) | 全成功场景;失败降级到 4~0 |
| 重新生成单单元 | 1 | 用户主导 | S3 局部操作 |
| 提交 | 1 | 1 | 必跑 |
| 重新合成 | 1 | 用户主导 | S4 「重新生成」按钮 |
| **总计(最短路径)** | | **7 次** | 1+0+5+1(无追问、无重生成) |
| **总计(全部重生成,20 追问)** | | **28 次** | 1+20+5+1+1(1 次重新合成) |

---

## 4. 数据模型

### 4.1 维度枚举

固定 5 维度,后端用 `str, Enum`,前端 TypeScript 用 union:

```python
# backend/creative_os/three_b_engine.py
from enum import Enum

class Dimension(str, Enum):
    ONTOLOGY = "ontology"               # 世界构成
    ENERGETICS = "energetics"            # 能量体系
    POWER_STRUCTURE = "power_structure"  # 社会控制
    PROTAGONIST_ENGINE = "protagonist_engine"  # 主角机制
    NARRATIVE_PHYSICS = "narrative_physics"    # 叙事动力
```

中文标签存 `backend/services/dimension_labels.py`,前后端共用(避免 i18n 漂移)。

### 4.2 核心 dataclass

**Unit** — 拆解产出的基本单元。追问时原地替换 `description`,记录 `follow_up_count` 计数与 `is_irreducible` 标记:

```python
@dataclass
class Unit:
    id: str                           # "unit_<6hex>"
    dimension: Dimension
    unit_name: str                    # LLM 给的网文子域标签,如 "灵窍"
    description: str                  # 当前描述(追问可改写)
    follow_up_count: int = 0
    is_irreducible: bool = False      # LLM 标记"不可再分"
```

**UnitCandidate** — 自适应发散引擎产出的单单元候选。形状与 Unit 对齐:

```python
@dataclass
class UnitCandidate:
    id: str
    unit_id: str                      # 关联 Unit.id
    unit_name: str                    # 复制,便于 hydrate 不依赖 Unit
    description: str
    selection_rank: int               # 0 或 1
```

**DimensionDecomposition** — 单维度的完整状态机:

```python
@dataclass
class DimensionDecomposition:
    dimension: Dimension
    units: list[Unit]
    candidates: list[UnitCandidate]   # 空 = 未发散或失败
    dimension_status: str             # "pending" | "decomposed" | "diverged" | "divergence_failed"
```

### 4.3 ThreeBState schema v2

```python
@dataclass
class ThreeBState:
    schema_version: int = 2            # 旧版为 1
    project_id: str = ""
    raw_intent: Optional[RawIntent] = None

    # Stage 2 拆解
    decompose_started_at: Optional[str] = None
    decompose_completed_at: Optional[str] = None

    # 维度列表(拆解 + 发散结果)
    dimensions: list[DimensionDecomposition] = field(default_factory=list)

    # Stage 3 发散(元数据)
    diverge_started_at: Optional[str] = None
    diverge_completed_at: Optional[str] = None

    # Stage 4 提交
    commit_started_at: Optional[str] = None
    commit_completed_at: Optional[str] = None
    committed_concept: Optional[dict] = None  # 见 §4.4
    novelty_scores: Optional[dict] = None
```

**字段变化(相对 v1):**

| 移除(v1) | 新增(v2) |
|---|---|
| `stage1_completed_at` | `decompose_started_at` / `decompose_completed_at` |
| `stage2_started_at` / `stage2_completed_at` / `stage2_candidates` | `diverge_started_at` / `diverge_completed_at` + 嵌入 `dimensions[].candidates` |
| `stage3_deepened` | (不设独立字段,深化操作只在 Stage 4 commit 时一次性完成) |
| `committed_at`(独立字段) | `commit_completed_at`(语义更明确) |

### 4.4 committed_concept 字段

存于 `state.committed_concept`,提交阶段产出 + 用户编辑 + 应用状态:

```python
{
    "one_line": str,        # ≤50 字
    "expanded": str,        # 100-200 字
    "core_tension": str,    # 50-80 字
    "tone": str,            # 调性标签
    "logline": str,         # ≤80 字
    "edited_by_user": bool, # 是否用户编辑过
    "applied_at": Optional[str],  # 最后一次写 concept_and_dna.json 的时间(ISO);null 表示从未应用
    "_migrated_from_v1": Optional[bool],  # v1→v2 迁移标记;前端用于显示横幅
}
```

`concept_and_dna.json` 仍按现有 schema(由 `stage2_world_char.py:141` 读 `story_dna`):

```json
{
    "concept": { /* committed_concept 字段,不含内部标记 */ },
    "story_dna": {
        "core_contradiction": {"statement": "<core_tension>"},
        "value_stack": [],
        "tone": "<tone>"
    },
    "source": "creative_divergence",
    "three_b_snapshot": {
        "schema_version": 2,
        "applied_at": "<ISO>"
    }
}
```

`creative_divergence.json`(compat)写:

```json
{
    "prompt": "<prompt, 截断 1700 字>",
    "variants": [],
    "selected_id": null,
    "selected_at": "<ISO>",
    "source": "creative_divergence"
}
```

---

## 5. 状态迁移 v1 → v2

`backend/creative_os/three_b_engine.py:migrate_state_on_load(project_id)`:

```python
def migrate_state_on_load(project_id: str) -> Optional[ThreeBState]:
    raw = _load_raw_json(project_id)  # 不做 dataclass 重建
    if raw is None:
        return None
    if raw.get("schema_version") == 2:
        return _build_state_v2_from_raw(raw)
    # v1 → v2
    v2 = ThreeBState(
        schema_version=2,
        project_id=project_id,
        raw_intent=raw.get("raw_intent"),
        decompose_completed_at=raw.get("stage1_completed_at"),
    )
    if raw.get("committed"):
        cd_path = Path(settings.projects_dir) / project_id / "concept_and_dna.json"
        if cd_path.exists():
            try:
                existing = json.loads(cd_path.read_text(encoding="utf-8"))
                v2.committed_concept = {
                    **existing.get("concept", {}),
                    "edited_by_user": False,
                    "applied_at": existing.get("three_b_snapshot", {}).get("committed_at"),
                    "_migrated_from_v1": True,
                }
            except Exception:
                logger.warning("v1 migration: failed to read concept_and_dna.json for %s", project_id)
    atomic_write_state(project_id, v2)
    return v2
```

**前端行为:** `useThreeBDivergence` hydrate 时若 `dimensions.length === 0 && committed_concept?._migrated_from_v1 === true`,显示横幅「创意发散已升级到 4 阶段流程,此前提交的创意已保留,但需要重新走拆解/发散才能生成新版本」。

**测试:** `tests/test_creative_os/test_three_b_migration.py` 覆盖 3 个场景:无 v1 文件 / 有 v1 文件未提交 / 有 v1 文件已提交。

---

## 6. 后端实现

### 6.1 ThreeBEngine 方法

```python
class ThreeBEngine:
    def __init__(self, model_router=None): ...

    # Stage 2
    async def decompose(
        self, project_id: str, raw_intent: RawIntent
    ) -> list[DimensionDecomposition]:
        """1 次 LLM 调用,返回 5 维度的拆解结果。
        失败抛 ValueError → routes 转 422;LLM/网络异常 → routes 转 503 DECOMPOSE_FAILED。
        """

    async def follow_up_unit(
        self, project_id: str, unit_id: str, user_question: Optional[str]
    ) -> Unit:
        """追问单单元。LLM 原地替换 description。
        若 unit 已 is_irreducible=True → ValueError("unit 已不可约化") → 422。
        """

    # Stage 3
    async def diverge_per_dimension(
        self, project_id: str
    ) -> list[DimensionDecomposition]:
        """5 维度 asyncio.gather,每维度 1 次 LLM 调用。
        单维度失败 → 该维度 dimension_status='divergence_failed',其他继续。
        全失败 → 抛异常 → routes 转 503。
        """

    async def regenerate_unit(
        self, project_id: str, unit_id: str
    ) -> UnitCandidate:
        """重跑该 (unit_id 所在) 维度的发散,只返回该 unit 的新候选。
        其他 unit 候选保留(不重置)。
        """

    async def select_unit_candidate(
        self, project_id: str, unit_id: str, candidate_index: int
    ) -> DimensionDecomposition:
        """纯本地操作,切换 selected_index。candidate_index 必须 < len(candidates)。
        """

    # Stage 4
    async def commit(self, project_id: str) -> dict:
        """LLM 合成 1 次。失败维度在 prompt 中标注 [维度 X 未参与],让 LLM 跳过。
        写 state.committed_concept + concept_and_dna.json + creative_divergence.json。
        """

    async def edit_committed_concept(
        self, project_id: str, edited_fields: dict
    ) -> dict:
        """用户编辑保存。仅覆盖 state.committed_concept,设 edited_by_user=true。
        不写 concept_and_dna.json(由 apply 触发)。
        """

    async def apply_committed_concept(
        self, project_id: str
    ) -> dict:
        """将 state.committed_concept 写入 concept_and_dna.json。
        设置 applied_at = now。幂等(可重复)。
        """
```

### 6.2 Prompt 文件

| 文件 | 状态 | 职责 |
|---|---|---|
| `backend/prompts/creative/three_b_decompose.yaml` | 新建 | 5 维度第一性拆解(参考 `docs/design/创意分解.md`) |
| `backend/prompts/creative/three_b_follow_up.yaml` | 新建 | 单单元原地追问 |
| `backend/prompts/creative/three_b_diverge.yaml` | 新建 | 5 维度自适应发散(参考 `docs/design/自适应发散引擎.md`) |
| `backend/prompts/creative/three_b_commit.yaml` | 修改 | 输入从"deepened candidates"改为"selected units across dimensions" |
| `backend/prompts/creative/three_b_breaking.yaml` | **删除** | — |
| `backend/prompts/creative/three_b_bending.yaml` | **删除** | — |
| `backend/prompts/creative/three_b_blending.yaml` | **删除** | — |

**Prompt Plaza 自动发现机制**(`backend/services/global_prompt_override_store.py:37-87` 的 `_iter_yaml_files`)无需手动注册,新增/删除 YAML 即生效。

### 6.3 API 端点(全部 `/api/v1/projects/{project_id}/creative/diverge/three-b/*`)

| Method | Path | Body | 成功返回 | 失败码 |
|---|---|---|---|---|
| GET | `/state` | — | ThreeBState(走 migrate) | 404 |
| DELETE | `/state` | — | `{deleted: true}` | 404 |
| POST | `/decompose` | `{prompt, genre_primary, genre_secondary}` | `{dimensions: [...]}` | 422 / 503 |
| POST | `/follow-up` | `{unit_id, user_question?}` | `{unit: Unit}` | 422 |
| POST | `/diverge` | — | `{dimensions: [...]}` | 422 / 503 |
| POST | `/regenerate-unit` | `{unit_id}` | `{unit, candidates: [UnitCandidate]}` | 422 / 503 |
| POST | `/select-unit` | `{unit_id, candidate_index}` | `{dimension}` | 422 |
| POST | `/commit` | — | `{committed_concept, novelty_scores}` | 422 / 503 |
| POST | `/edit-concept` | `{one_line?, expanded?, core_tension?, tone?, logline?}` | `{committed_concept}` | 422 |
| POST | `/apply-concept` | — | `{committed_concept, applied_at}` | 422 |
| POST | `/reset-and-restart` | — | `{deleted: true}` | 404 |

### 6.4 关键不变量

- `atomic_write_state` 沿用现有 `.tmp + os.replace` 模式(`three_b_engine.py:121-132`)
- 每次 state 写盘都是**完整 ThreeBState**,不增量 patch(简化 hydrate)
- `diverge_per_dimension` 用 `asyncio.gather(*, return_exceptions=True)`,内部对每个维度的 LLM 异常捕获并降级
- `select_unit_candidate` / `regenerate_unit` 走 atomic_write(改变了维度状态)
- `edit_committed_concept` 字段白名单:只允许 5 个文本字段,其余字段(`edited_by_user`, `applied_at`, `_migrated_from_v1`)由后端控制

### 6.5 删除文件

| 文件 | 原因 |
|---|---|
| `backend/prompts/creative/three_b_breaking.yaml` | 旧算子 |
| `backend/prompts/creative/three_b_bending.yaml` | 旧算子 |
| `backend/prompts/creative/three_b_blending.yaml` | 旧算子 |

---

## 7. 前端实现

### 7.1 组件结构

```
CreativeDivergenceStep.tsx (orchestrator)
├── StepIndicator.tsx (4 阶段)
├── [可选] MigrationBanner.tsx (v1 迁移提示,本地 React state)
└── 当前阶段组件:
    ├── S1InputStep.tsx (保留,基本不改)
    ├── S2DecomposeStep.tsx (新建)
    ├── S3DivergeStep.tsx (新建)
    └── S4CommitStep.tsx (新建)
```

### 7.2 状态机:useThreeBDivergence reducer

```typescript
type SubStage = "1" | "2" | "3" | "4";

interface State {
  currentSubStage: SubStage;
  completedSubStages: SubStage[];
  rawIntent: RawIntent | null;

  // Stage 2
  decomposing: boolean;
  decomposeError: string | null;
  dimensions: DimensionDecomposition[];
  followUpLoadingUnitId: string | null;

  // Stage 3
  diverging: boolean;
  divergeError: string | null;

  // Stage 4
  committing: boolean;
  commitError: string | null;
  committedConcept: CommittedConcept | null;
  editingConcept: boolean;
  applyingConcept: boolean;
}

type Action =
  | { type: "HYDRATE"; state: Partial<State> }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "DECOMPOSE_START" }
  | { type: "DECOMPOSE_SUCCESS"; dimensions: DimensionDecomposition[] }
  | { type: "DECOMPOSE_ERROR"; message: string }
  | { type: "FOLLOW_UP_START"; unitId: string }
  | { type: "FOLLOW_UP_SUCCESS"; unit: Unit }
  | { type: "FOLLOW_UP_ERROR"; message: string }
  | { type: "DIVERGE_START" }
  | { type: "DIVERGE_SUCCESS"; dimensions: DimensionDecomposition[] }
  | { type: "DIVERGE_ERROR"; message: string }
  | { type: "REGENERATE_UNIT_SUCCESS"; dimension: DimensionDecomposition }
  | { type: "SELECT_UNIT_CANDIDATE"; unitId: string; candidateIndex: number }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS"; committedConcept: CommittedConcept; noveltyScores: NoveltyScores }
  | { type: "COMMIT_ERROR"; message: string }
  | { type: "EDIT_CONCEPT_START" }
  | { type: "EDIT_CONCEPT_SUCCESS"; committedConcept: CommittedConcept }
  | { type: "EDIT_CONCEPT_CANCEL" }
  | { type: "APPLY_START" }
  | { type: "APPLY_SUCCESS"; appliedAt: string }
  | { type: "ADVANCE_TO_NEXT_STAGE" }
  | { type: "JUMP_TO_STAGE"; stage: SubStage }
  | { type: "RESET" };
```

### 7.3 S2DecomposeStep UX

```
┌──────────────────────────────────────────────────┐
│ Stage 2 · 第一性拆解 · 5 维度                     │
├──────────────────────────────────────────────────┤
│ ▾ 世界构成 (Ontology)                  已拆解     │
│   ┌─ 灵窍 [Unit #abc123]                        │
│   │  灵窍是修炼者与天地能量交互的接口,通过认证  │
│   │  密钥与频率调谐实现能量转换...                │
│   │  [追问] [已追问 2 次] [可再分]               │
│   ├─ 本源 [Unit #def456]                        │
│   │  ...                                        │
│   └─ ...                                        │
│                                                  │
│ ▾ 能量体系 (Energetics)               已拆解     │
│   ...                                            │
│                                                  │
│ [全部追问失败回退: 上一步]   [下一步: 发散 →]   │
└──────────────────────────────────────────────────┘
```

**追问按钮:**
- 单元 `is_irreducible=true` 时按钮 disabled,文字"已不可再分"
- 否则点击弹出 PromptDialog(单 input + 取消/确认);空提交 = 调用 follow-up prompt 的默认追问
- 追问中按钮显示 loading,整个 unit 卡片半透明

### 7.4 S3DivergeStep UX

```
┌──────────────────────────────────────────────────┐
│ Stage 3 · 自适应发散 · 5 维度 × N 单元            │
│ [全部重新生成]                                    │
├──────────────────────────────────────────────────┤
│ ▾ 世界构成                                       │
│   ┌─ 灵窍 [Unit #abc123]                        │
│   │  原始: 灵窍是修炼者与天地能量交互的接口...    │
│   │  ○ 候选 A: 灵窍裂变为多个子接口,每个对应     │
│   │    不同频率的能量流,修炼者需协调多接口...     │
│   │  ● 候选 B: 灵窍是一种量子纠缠态,认证密钥... │
│   │  [重新生成该单元]                            │
│   ├─ 本源 [Unit #def456]                        │
│   │  ...                                        │
│                                                  │
│ ▾ 能量体系  [该维度暂不可用]                      │
│   (divergence_failed 状态,所有 unit 显示提示)   │
│                                                  │
│ [上一步: 拆解]   [下一步: 提交 →]                 │
└──────────────────────────────────────────────────┘
```

- 候选切换走 POST `/select-unit`(纯本地操作,无 LLM,响应快)
- 「重新生成该单元」走 POST `/regenerate-unit`(只重跑该维度,返回该 unit 新候选;其他 unit 不动)
- 「全部重新生成」走 POST `/diverge`(整阶段重跑)
- 进入 S3 时若 `dimensions[].candidates` 已存在,**不自动重跑**(让用户能继续编辑)

### 7.5 S4CommitStep UX

```
┌──────────────────────────────────────────────────┐
│ Stage 4 · 提交                                    │
├──────────────────────────────────────────────────┤
│ 显示模式:                                         │
│   one_line: 修炼者掌握双规则体系的觉醒之路          │
│   expanded: ...                                  │
│   core_tension: ...                              │
│   tone: 暗黑悬疑                                  │
│   logline: ...                                   │
│   [用户已编辑] (edited_by_user=true 时显示)       │
│   [未应用] / [已应用: 2026-09-06 16:42]           │
│                                                  │
│   [编辑] [重新生成] [应用]                        │
│   (重新生成按钮二次确认 dialog)                    │
│                                                  │
│ 编辑模式:                                         │
│   one_line: [textarea]                           │
│   expanded: [textarea × 200 字]                   │
│   ...                                            │
│   [保存编辑] [取消编辑]                          │
│                                                  │
│ [下一步: 进入概念DNA →] (committedConcept 非空)    │
└──────────────────────────────────────────────────┘
```

- 「重新生成」→ POST `/commit`,二次确认弹窗(避免误操作覆盖已编辑版本)
- 「编辑」→ 切到编辑模式,内部 React state,不立即调 API
- 「保存编辑」→ POST `/edit-concept`,回到显示模式,显示「用户已编辑」
- 「应用」→ POST `/apply-concept`,成功后更新 `applied_at` 显示

### 7.6 Hydrate 与 v1 横幅

```typescript
useEffect(() => {
  let cancelled = false;
  api.getThreeBState(projectId).then((s) => {
    if (cancelled) return;
    const isMigrated = s.dimensions.length === 0 &&
                       s.committed_concept?._migrated_from_v1 === true;
    const completed: SubStage[] = ["1"];
    if (s.dimensions.length > 0) completed.push("2");
    if (s.dimensions.some((d) => d.candidates.length > 0)) completed.push("3");
    if (s.committed_concept !== null) completed.push("4");
    dispatch({
      type: "HYDRATE",
      state: {
        rawIntent: s.raw_intent,
        dimensions: s.dimensions,
        committedConcept: s.committed_concept,
        currentSubStage: s.committed_concept ? "4"
          : s.dimensions.some((d) => d.candidates.length > 0) ? "3"
          : s.dimensions.length > 0 ? "2"
          : "1",
        completedSubStages: completed,
      },
    });
    if (isMigrated) setShowMigrationBanner(true);
  });
  return () => { cancelled = true; };
}, [projectId]);
```

### 7.7 文件清单

| 文件 | 操作 |
|---|---|
| `frontend/src/components/wizard/divergence_v2/types.ts` | **重写** 移除 Operator / Candidate / DeepenedCandidate,新增 Dimension / Unit / UnitCandidate / CommittedConcept |
| `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` | 保留(几乎不改) |
| `frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx` | **删除** |
| `frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx` | **删除** |
| `frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/S4CommitStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/MigrationBanner.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts` | **重写** |
| `frontend/src/components/wizard/divergence_v2/StepIndicator.tsx` | 改 SUB_STAGES 为 4 项 |
| `frontend/src/api/client.ts` | 9 个方法对应 9 个新端点(+ apply-concept + reset-and-restart) |

---

## 8. UX 规则汇总

| 场景 | 行为 |
|---|---|
| S2 进入时 `dimensions=[]` | 自动触发 `/decompose` |
| 追问时 `is_irreducible=true` | 422 → UI 显示 inline error "该单元已不可约化" |
| 追问时 LLM 失败 | 显示 "追问失败,可重试" + 重试按钮 |
| S3 进入时全部维度 `divergence_failed` | 顶部红色 banner + 「全部重新生成」可点 |
| S3 单维度 `divergence_failed` | 该维度组显示"该维度暂不可用",其他维度正常 |
| S4 「重新生成」点击 | 二次确认 dialog(防误覆盖已编辑版本) |
| S4 「编辑」→ 「保存编辑」后 | 显示「用户已编辑」标签,「应用」按钮可点 |
| S4 「应用」成功 | 显示「已应用: <时间>」 |
| 提交后点 StepIndicator chip「4. 提交」 | 跳回 S4,显示已保存版本,不重新合成 |
| 任何阶段网络 503 | 显示 "操作失败,可重试" + 重试按钮,不丢失当前 state |

---

## 9. 测试覆盖

### 9.1 后端

| 文件 | 覆盖 |
|---|---|
| `tests/test_creative_os/test_three_b_engine.py` | 8 方法 happy path + 异常 + asyncio.gather 失败降级 |
| `tests/test_creative_os/test_three_b_migration.py` | v1→v2 三场景(无/未提交/已提交) |
| `tests/test_creative_os/test_three_b_state.py` | atomic_write_state 沿用现有测试 |
| `tests/test_api/test_three_b_routes.py` | 11 端点契约 + 422/404/503 错误码 |
| `tests/test_prompts/test_three_b_yaml.py` | 4 YAML schema 校验(原 3b yaml 文件已删,只校验新 4 个) |

### 9.2 前端

| 文件 | 覆盖 |
|---|---|
| `test/wizard/divergence_v2/S2DecomposeStep.test.tsx` | 5 维度渲染 + 追问按钮 + 不可约化 disabled |
| `test/wizard/divergence_v2/S3DivergeStep.test.tsx` | 候选 radio 切换 + 单单元重新生成 + 全部重新生成 |
| `test/wizard/divergence_v2/S4CommitStep.test.tsx` | 5 字段展示 + 编辑保存 + 应用 + 重新生成二次确认 |
| `test/wizard/divergence_v2/StepIndicator.test.tsx` | 4 阶段 jump 规则 |
| `test/wizard/divergence_v2/MigrationBanner.test.tsx` | v1 迁移横幅显示/隐藏 |
| `test/wizard/divergence_v2/useThreeBDivergence.test.ts` | reducer 状态转换 |
| `test/wizard/CreativeDivergenceStep.test.tsx` | 重写为 4 阶段 orchestrator |

---

## 10. 验收标准

1. **流程可走通:** 4 阶段全部成功提交后,`<project>/concept_and_dna.json` 与 `creative_divergence.json` 内容字段齐备,`stage2_world_char.py` 可正常读取。
2. **追问生效:** 对任一 unit 追问一次后,刷新页面 hydrate,description 已更新,`follow_up_count` 增加,`is_irreducible` 状态保留(若 LLM 标记)。
3. **追问不可约化:** unit `is_irreducible=true` 时追问按钮 disabled,直接调用 API 返回 422。
4. **发散失败降级:** mock 5 个维度中 2 个 LLM 抛异常,其余 3 个返回正常候选,UI 显示该 2 个维度为"该维度暂不可用",其余可正常切换。
5. **编辑保存:** 用户编辑 → 保存 → 刷新页面,显示「用户已编辑」,`edited_by_user=true`,`concept_and_dna.json` **未变更**。
6. **应用生效:** 用户编辑 → 保存 → 应用 → `concept_and_dna.json` 内容已包含编辑版本,`applied_at` 时间戳更新。
7. **v1 迁移:** 模拟 v1 state 文件 + 已 committed → 加载后 `committed_concept._migrated_from_v1=true`,前端横幅显示,dimensions 空。
8. **旧算子 yaml 删除:** `git grep three_b_breaking` 在 backend/prompts/creative/ 无命中。
9. **测试通过:** 后端 `pytest tests/test_creative_os/test_three_b*.py tests/test_api/test_three_b_routes.py tests/test_prompts/test_three_b_yaml.py` 全绿;前端 `npm test` 全绿。
10. **类型一致:** 前端 `types.ts` 与后端 dataclass 字段名一一对应(`snake_case` 转换在 API 边界完成)。

---

## 11. 范围外 (Out of Scope)

- 追问历史的撤销/版本树(只保留计数)
- 自动检测"不可约化"(完全由 LLM 标记,不做二次验证)
- 多语言 i18n 框架(中文标签硬编码)
- Stage 2 维度数量自适应(固定 5 维度)
- 单元数量自适应(每维度 3-5 单元由 LLM 决定,但不加约束)
- 旧 Path B `/creative-divergence/*` 接口改造(deprecation header 继续生效)
- Prompt Plaza UI 改造(YAML 自动发现已生效,无需改前端)

---

## 12. 实施依赖与顺序

1. **Step 1**:新建 4 个 prompt YAML + 删除 3 个旧算子 YAML
2. **Step 2**:重写 `three_b_engine.py` dataclass + engine 方法
3. **Step 3**:重写 `three_b_routes.py`(11 端点)
4. **Step 4**:重写前端 `types.ts` + 新建 3 个步骤组件 + reducer 重写 + StepIndicator 改 4 阶段
5. **Step 5**:更新 `api/client.ts`(11 方法)
6. **Step 6**:写测试(后端 5 文件 + 前端 7 文件)
7. **Step 7**:v1 迁移手动验证 + 端到端 happy path + LLM 调用实际跑通
