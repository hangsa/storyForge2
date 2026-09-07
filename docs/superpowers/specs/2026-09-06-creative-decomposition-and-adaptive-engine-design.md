# 创意发散 4 阶段流程：拆解 + 自适应发散引擎

> **Status:** Draft for review
> **Author:** Claude (brainstorming with user)
> **Date:** 2026-09-06
> **Replaces:** `2026-09-04-creative-divergence-3b-redesign-design.md` (3 阶段 3B 流程已 ship 2026-09-05)

---

## 1. 目标与非目标

### 1.1 目标

Wizard 「创意发散」重写为 4 阶段流程:

```
输入 → 拆解 → 自适应发散 → 提交
```

具体:

1. **新增「拆解」阶段**(Stage 2):按 `docs/design/创意分解.md` 的第一性原理方法论,把用户灵感拆解为 5 个固定维度 × 每维度 3-5 个基本单元,每维度产出 `insight`(核心洞察),全程产出 `causal_map`(5 维度因果传导链)与 `top_level_summary`(终极总结,≤150 字);支持对任一基本单元「追问」(原地替换 `description`)。
2. **新增「自适应发散引擎」**(Stage 3):对每个 (维度 × 单元) 对,**unit 级**独立应用 `docs/design/自适应发散引擎.md` 的「5 维扫描 → 路由 → 主辅算子 → 连锁推演」流程,产出 2-3 个候选,每个候选附带 `chain_reaction`(连锁推演)。组合链在本 spec 中**视为单算子**(N1=b),不实际做 3 步复合调用。
3. **新增「提交」阶段**(Stage 4):基于所有选定的单元 + `causal_map` + `top_level_summary`,LLM 合成 5 字段 concept(`one_line / expanded / core_tension / tone / logline`)。用户可编辑,「下一步」**直接写盘** `concept_and_dna.json` + `creative_divergence.json` + `novelty_scores`(无独立 apply 步骤)。
4. **状态文件 schema 升级到 v2**,迁移时**直接删除**旧 v1 文件,强制重走。
5. **跳回非破坏**(N4):StepIndicator 后向跳转只切 UI state,不动数据;任一阶段点「下一步」时,若目标阶段及其后有数据,弹二次确认 dialog,确认后清空下游并执行该阶段动作。

### 1.2 非目标

- 不修改 `concept_and_dna.json` 的下游消费者(`stage2_world_char.py` 等只读 `story_dna` 与 `concept`,字段语义不变)
- 不重写 Prompt Plaza / LLM Config / 状态机外部设施
- 不修改旧 `creative_divergence.json` / `creative-divergence/*` Path B 接口(继续走 deprecation header)
- 不实现追问历史的撤销/版本回滚(只保留 `follow_up_count` 计数)
- 不实现组合链的 3 步复合调用(N1=b,LLM 自报"用组合链"但不实际多步)
- 不自动检测"不可约化"(完全由 LLM 标记,无保险丝)
- 不实现 Stage 2 维度数量自适应(固定 5 维度)
- 不实现 i18n 框架(中文标签硬编码在 `dimension_labels.py`)

---

## 2. 背景与动机

### 2.1 现有实现回顾

`2026-09-04-creative-divergence-3b-redesign-design.md` 已 ship 2026-09-05,实现 3 阶段 3B 算子并行流程:

| 阶段 | 操作 | 后端方法 | 状态 |
|---|---|---|---|
| Stage 1 输入 | prompt + genres | `DivergeRequest` | ✓ |
| Stage 2 3B 发散 | 3 算子 `asyncio.gather` | `ThreeBEngine.diverge` | ✓ |
| Stage 3 深化提交 | 选不同算子二次深化 + commit | `ThreeBEngine.deepen/commit` | ✓ |

3B 流程的核心问题(详见旧 spec §2.1):

| 问题 | 根因 |
|---|---|
| 用户缺乏「明确理解自己的灵感」的过程 | 5 阶段流程已合并为 3 阶段,但仍无显式拆解步骤 |
| 「打破 / 扭曲 / 融合」3 算子是固定路由,未按设定特征自动选择 | `_call_operator` 直接调固定 3 个 yaml,无扫描路由 |
| 深化阶段本质仍是 3B 固定套路,没有「规则改变 → 连锁推演」能力 | prompt 让 LLM 二次产点子,但不要求推演连锁反应 |

### 2.2 新流程的核心改进

新流程按 `docs/design/创意分解.md` + `docs/design/自适应发散引擎.md` 两份设计文档构建:

1. **强制「第一性拆解」**:用户先经历 5 维度拆解,得到 N 个「基本单元」+ 每维度 `insight` + 全局 `causal_map` + `top_level_summary`,让用户清晰知道自己的灵感包含哪些可操作的维度与单元。
2. **发散阶段 unit 级应用自适应引擎**:不再固定 3 算子并行,而是按 `自适应发散引擎.md` 的 5 维扫描,LLM 自动选主辅算子(扭曲/打破/融合/组合链),每个候选必须输出 `chain_reaction`(规则改变后的世界连锁变化)。
3. **提交阶段有锚点合成**:LLM 看到的不是孤立的候选,而是「用户已选定的单元 + 全局因果图谱与总结」,合成的 concept 与原始意图对齐度更高。
4. **跳回非破坏,推进清空**:后向跳转安全(无数据丢失),「下一步」带二次确认(防误覆盖),降低用户操作焦虑。

### 2.3 关键设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 维度体系 | **固定 5 维度** + 网文子域自由 | 5 大维度枚举化(可测试/可渲染),`unit_name` 由 LLM 根据题材决定 |
| 拆解 4 类输出 | **insight / causal_map / top_level_summary 全保留**(Q2) | 与 `创意分解.md` 文档对齐;insight/causal_map 给用户看,top_level_summary 给 commit prompt 作锚点 |
| 追问语义 | **原地替换 description** | 简单可逆,无需版本树;追问失败只丢当前 unit |
| 引擎扫描颗粒度 | **unit 级**(N2=a) | 每 Unit 独立扫描+路由,变异最大 |
| 引擎 yaml 形式 | **1 个综合 yaml**(N3=b) | 扫描+路由+4 算子在同 prompt 内,Prompt Plaza 暴露 1 entry |
| 组合链处理 | **视为单算子**(N1=b) | LLM 自报"用组合链"但不实际多步调用,避免时长 ×3 |
| 提交合成 | **LLM 合成 + causal_map + top_level_summary 锚点** | 全局总结作为"叙事粘合"依据 |
| 编辑后写盘 | **「下一步」直接写盘**(Q4) | 移除独立 apply 步骤,「下一步」= commit(如需) + 写盘 + 通知 wizard |
| 状态迁移 | **v1 文件直接删除** + 强制重走( Q5) | 边界清晰,旧 3B 历史不再保留 |
| 跳回语义 | **后向跳转非破坏,「下一步」清空下游**(Q3+N4) | 降低误操作成本,二次确认防覆盖 |

---

## 3. 架构概览

### 3.1 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1 输入                                                    │
│  S1InputStep: prompt + genre_primary + genre_secondary           │
│       │                                                          │
│       ▼ 用户点「下一步: 拆解 →」                                  │
│       │ 检查: 若 dimensions/candidates/committed_concept 非空      │
│       │ → 二次确认 dialog(若原维度不为空,确认后清空 + decompose)│
│       │ 确认 / 首次 → POST /decompose                             │
│       │                                                          │
│  ThreeBEngine.decompose (1 次 LLM 调用)                          │
│       │ 输入: prompt + genres                                    │
│       │ 输出: 5 dimensions × N units, 每维度 insight,            │
│       │       causal_map (5维因果传导), top_level_summary (≤150) │
│       ▼ 写 state: dimensions, causal_map, top_level_summary       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 2 拆解                                                    │
│  S2DecomposeStep: 展示 5 维度 × N units + 每维度 insight header   │
│       │ 底部展示 causal_map                                      │
│       │ 每 unit 「追问」按钮                                     │
│       │                                                          │
│       ▼ POST /follow-up {unit_id, user_question?}                │
│  ThreeBEngine.follow_up_unit (1 次 LLM 调用,原地替换 description)│
│       │                                                          │
│       ▼ 用户点「下一步: 发散 →」                                 │
│       │ 检查: 若 candidates/committed_concept 非空                │
│       │ → 二次确认 dialog(确认后清空 + diverge)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3 发散                                                    │
│  S3DivergeStep: per-unit 自适应发散候选                          │
│       │ 每个 unit 显示 N 候选(radio) + chain_reaction 描述       │
│       │ 失败 unit 在 unit 卡片显示「该单元暂不可用」              │
│       │                                                          │
│       ▼ POST /diverge (后端 per-unit N LLM 调用)                 │
│  ThreeBEngine.diverge: N units × 1 LLM, asyncio.gather(5)        │
│       │ 每 unit prompt: scan + 路由 + 主辅算子 + 3-5 候选       │
│       │                                                          │
│       ▼ 用户 radio 切换 / POST /select-unit (纯本地)              │
│       │ 「重新生成该单元」/POST /regenerate-unit                  │
│       │ 「全部重新生成」/POST /diverge                           │
│       │                                                          │
│       ▼ 用户点「下一步: 提交 →」                                 │
│       │ 检查: 若 committed_concept 非空                          │
│       │ → 二次确认 dialog(确认后清空 + 进入 S4)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4 提交                                                    │
│  S4CommitStep: 显示 committed_concept 5 字段(若空显示空态)        │
│       │                                                          │
│       │ 用户可: 「编辑」→ 切编辑模式 → 「保存编辑」→ POST /edit-concept │
│       │       「重新生成」→ 二次确认 → POST /commit                │
│       │       「全部重新生成」→ POST /diverge(跳回 S3)            │
│       │                                                          │
│       ▼ 用户点「下一步: 进入概念DNA →」                          │
│       │ 若 committed_concept 为 null → 先 POST /commit(LLM 合成)│
│       │ 然后 POST /advance: 写 concept_and_dna.json +              │
│       │                        creative_divergence.json +        │
│       │                        novelty_scores(顶层)              │
│       │ 通知 WizardContext,step 1 标记完成                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 总 LLM 调用次数

| 阶段 | 每次操作 | 最坏情况 | 说明 |
|---|---|---|---|
| 拆解 | 1 | 1 | 必跑 |
| 追问 | 1/次 | 用户主导 | 0~N 次,每次原地替换 |
| 发散 | N(units) | 典型 20 并行 | `asyncio.gather(Semaphore(5))`,失败降级 |
| 重新生成单单元 | 1 | 用户主导 | S3 局部操作 |
| 提交 | 1 | 1(若 ≥3 units 失败 → 422) | 必跑或「重新生成」触发 |
| 写盘(advance) | 0 | 0 | 纯本地操作 |
| **总计(最短路径)** | | **2 + N = 22**(N=20 units) | 1 拆解 + 20 发散 + 1 commit |
| **总计(全部重生成,20 追问,5 重新合成)** | | **48** | 1 + 20 + 5×(1 commit + 1 diverge) + 20 追问 |

---

## 4. 数据模型

### 4.1 维度枚举

固定 5 维度(同 v1 spec),后端 `str, Enum`,前端 TypeScript union:

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

中文标签存 `backend/services/dimension_labels.py`(前后端共用,避免 i18n 漂移)。

### 4.2 核心 dataclass

**Unit** — 拆解产出的基本单元:

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

**UnitCandidate** — 自适应发散引擎产出的单单元候选。形状与 Unit 对齐 + 自适应引擎专属字段:

```python
@dataclass
class UnitCandidate:
    id: str
    unit_id: str                      # 关联 Unit.id
    unit_name: str                    # 复制,便于 hydrate 不依赖 Unit
    description: str
    chain_reaction: str               # 连锁推演(主+辅算子综合后的世界连锁变化)
    main_operator: str                # "distort" | "break" | "blend" | "chain"
    aux_operator: Optional[str] = None  # 同上,LLM 可不选辅算子
    selection_rank: int               # 0..N-1,LLM 自评排序
```

**DimensionDecomposition** — 单维度的完整状态机:

```python
@dataclass
class DimensionDecomposition:
    dimension: Dimension
    insight: str                      # 核心洞察(per-dimension)
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
    causal_map: str = ""               # 5 维度因果传导链(全局,ASCII/Markdown)
    top_level_summary: str = ""        # 终极总结(≤150 字)
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
| `stage3_deepened` / `DeepenedCandidate` | (深化操作废除,unit 级自适应发散一步到位) |
| `committed: bool` / `committed_at`(独立字段) | `commit_completed_at`(语义更明确) |
| | `causal_map`(Q2 新增) |
| | `top_level_summary`(Q2 新增) |
| | `DimensionDecomposition.insight`(Q2 新增) |
| | `UnitCandidate.chain_reaction` / `main_operator` / `aux_operator`(Q1+N2 新增) |

### 4.4 committed_concept 字段

存于 `state.committed_concept`,提交阶段产出 + 用户编辑状态:

```python
{
    "one_line": str,        # ≤50 字
    "expanded": str,        # 100-200 字
    "core_tension": str,    # 50-80 字
    "tone": str,            # 调性标签
    "logline": str,         # ≤80 字
    "edited_by_user": bool, # 是否用户编辑过
}
```

`concept_and_dna.json` 仍按现有 schema(`stage2_world_char.py:141` 读 `story_dna`):

```json
{
    "concept": { /* committed_concept 字段,不含 edited_by_user */ },
    "story_dna": {
        "core_contradiction": {"statement": "<core_tension>"},
        "value_stack": [],
        "tone": "<tone>"
    },
    "novelty_scores": {
        "market_saturation": 30,
        "trope_similarity": 25,
        "contradiction_depth": 80,
        "discussion_potential": 70,
        "composite": 60,
        "grade": "B+"
    },
    "source": "creative_divergence",
    "three_b_snapshot": {
        "schema_version": 2,
        "committed_at": "<ISO>"
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
    raw = _load_raw_json(project_id)
    if raw is None:
        return None
    if raw.get("schema_version") == 2:
        return _build_state_v2_from_raw(raw)
    # v1 → v2: 直接删除旧文件(Q5),强制用户重走
    try:
        _state_path(project_id).unlink()
        logger.info("v1→v2 migration: deleted old file for %s", project_id)
    except FileNotFoundError:
        pass
    return None
```

**前端行为:** hydrate 收到 `null` 时:
1. 跳到 Stage 1
2. 显示一次性 toast「创意发散已升级到 4 阶段流程,旧版本已清除,请重新走一遍」(无持久 banner)

**测试:** `tests/test_creative_os/test_three_b_migration.py` 覆盖 2 个场景:
- 无 v1 文件 → 返回 None
- 有 v1 文件 → 删文件 + 返回 None

---

## 6. 后端实现

### 6.1 ThreeBEngine 方法

```python
class ThreeBEngine:
    def __init__(self, model_router=None): ...

    # Stage 2 拆解
    async def decompose(
        self, project_id: str, raw_intent: RawIntent
    ) -> tuple[list[DimensionDecomposition], str, str]:
        """1 次 LLM 调用,返回 (dimensions, causal_map, top_level_summary)。
        失败抛 ValueError → routes 转 422;LLM/网络异常 → 503 DECOMPOSE_FAILED。
        同时清空 dimensions/candidates/committed_concept(允许重新走)。
        """

    async def follow_up_unit(
        self, project_id: str, unit_id: str, user_question: Optional[str]
    ) -> Unit:
        """追问单单元。LLM 原地替换 description。
        若 unit.is_irreducible=True → ValueError("unit 已不可约化") → 422。
        """

    # Stage 3 发散
    async def diverge(self, project_id: str) -> list[DimensionDecomposition]:
        """对所有 units 并行调用自适应发散。
        N 个 units = N 次 LLM 调用(asyncio.gather, Semaphore(5), return_exceptions=True)。
        单 unit 失败 → 该 unit 的 candidates 空;若某 dimension 所有 unit 都失败 → dimension_status='divergence_failed'。
        同时清空 candidates/committed_concept(允许重新走)。
        全失败 → 抛异常 → 503。
        """

    async def regenerate_unit(
        self, project_id: str, unit_id: str
    ) -> UnitCandidate:
        """重跑该 unit 的发散,只返回该 unit 的新候选。
        其他 unit 候选保留。
        走单一 LLM 调用(无并发,与单元独立发散同 prompt)。
        """

    async def select_unit_candidate(
        self, project_id: str, unit_id: str, candidate_index: int
    ) -> DimensionDecomposition:
        """纯本地操作,切换 selection_rank 指向 candidate_index(不存 selected 字段,以 rank 表示)。
        candidate_index 必须 < len(candidates)。
        """

    # Stage 4 提交
    async def commit(self, project_id: str) -> dict:
        """LLM 合成 1 次。
        失败 unit 在 prompt 中标注 [unit X 未参与],让 LLM 跳过。
        拒绝条件: ≥3 units 的 candidates 都为空 → 422 COMMIT_INSUFFICIENT。
        写 state.committed_concept + state.novelty_scores(state 内,concept_and_dna.json 不写)。
        """

    async def edit_committed_concept(
        self, project_id: str, edited_fields: dict
    ) -> dict:
        """用户编辑保存。仅覆盖 state.committed_concept,设 edited_by_user=true。
        不写 concept_and_dna.json(由 advance 触发)。
        """

    async def advance(self, project_id: str) -> dict:
        """写盘操作:
        - 若 state.committed_concept 为 null → 先调 commit() 合成。
        - 写 concept_and_dna.json(committed_concept + novelty_scores + three_b_snapshot)。
        - 写 creative_divergence.json(compat schema)。
        返回 {written: true, committed_at}。
        """

    # 删除(相对 v1):
    #   deepen / commit(原 v1,合并为 LLM 合成+advance)
    #   apply_committed_concept(Q4: 应用步骤合并到 advance)
```

### 6.2 Prompt 文件

| 文件 | 状态 | 职责 |
|---|---|---|
| `backend/prompts/creative/three_b_decompose.yaml` | 新建 | 5 维度第一性拆解 + insight(per-dim)+ causal_map + top_level_summary(参考 `docs/design/创意分解.md` 全 4 类输出) |
| `backend/prompts/creative/three_b_follow_up.yaml` | 新建 | 单单元原地追问 |
| `backend/prompts/creative/three_b_adaptive_diverge.yaml` | 新建 | **1 个综合 prompt**:5 维扫描诊断 + 路由 + 4 算子(扭曲/打破/融合/组合链-单算子)+ 主辅算子选 + 3-5 候选输出(含 chain_reaction)。参考 `docs/design/自适应发散引擎.md` 全部内容 |
| `backend/prompts/creative/three_b_commit.yaml` | 修改 | 输入加 causal_map + top_level_summary + 选定 units,锚点合成 5 字段 |
| `backend/prompts/creative/three_b_breaking.yaml` | **删除** | 旧 3B 算子 |
| `backend/prompts/creative/three_b_bending.yaml` | **删除** | 旧 3B 算子 |
| `backend/prompts/creative/three_b_blending.yaml` | **删除** | 旧 3B 算子 |

**Prompt Plaza 自动发现**:`_iter_yaml_files` 自动遍历 `backend/prompts/creative/*.yaml`,新增/删除 YAML 即生效。最终 Plaza 暴露 entry:

```
three_b_decompose
three_b_follow_up
three_b_adaptive_diverge
three_b_commit
```

### 6.3 API 端点(全部 `/api/v1/projects/{project_id}/creative/diverge/three-b/*`)

| Method | Path | Body | 成功返回 | 失败码 |
|---|---|---|---|---|
| GET | `/state` | — | ThreeBState(走 migrate) | 404 |
| DELETE | `/state` | — | `{deleted: true}` | 404 |
| POST | `/decompose` | `{prompt, genre_primary, genre_secondary}` | `{dimensions, causal_map, top_level_summary}` | 422 / 503 |
| POST | `/follow-up` | `{unit_id, user_question?}` | `{unit: Unit}` | 422 |
| POST | `/diverge` | — | `{dimensions}` | 422 / 503 |
| POST | `/regenerate-unit` | `{unit_id}` | `{unit, candidates: [UnitCandidate]}` | 422 / 503 |
| POST | `/select-unit` | `{unit_id, candidate_index}` | `{dimension}` | 422 |
| POST | `/commit` | — | `{committed_concept, novelty_scores}` | 422 / 503 |
| POST | `/edit-concept` | `{one_line?, expanded?, core_tension?, tone?, logline?}` | `{committed_concept}` | 422 |
| POST | `/advance` | — | `{written: true, committed_at}` | 422 / 503 |
| POST | `/reset-and-restart` | — | `{deleted: true}` | 404 |

(删除 `/apply-concept` —— Q4)

### 6.4 关键不变量

- `atomic_write_state` 沿用现有 `.tmp + os.replace` 模式(`three_b_engine.py:121-132`)
- 每次 state 写盘都是**完整 ThreeBState**,不增量 patch(简化 hydrate)
- `diverge` 用 `asyncio.gather(*, Semaphore(5), return_exceptions=True)`,内部对每个 unit 的 LLM 异常捕获并降级
- `select_unit_candidate` / `regenerate_unit` / `follow_up_unit` 走 atomic_write
- `edit_committed_concept` 字段白名单:5 个文本字段 + `edited_by_user`,其余字段(`applied_at` 已删)由后端控制
- `advance` 是幂等的:重复调用覆盖写盘,不引入额外 state
- `decompose` / `diverge` 写入时**清空下游字段**(允许重新走该阶段):
  - `decompose` 写盘前清空 `dimensions.candidates` + `committed_concept` + `novelty_scores` + 各 started_at/completed_at(下推到本阶段)
  - `diverge` 写盘前清空 `dimensions.candidates`(自身重写)+ `committed_concept` + `novelty_scores`

### 6.5 删除文件

| 文件 | 原因 |
|---|---|
| `backend/prompts/creative/three_b_breaking.yaml` | 旧 3B 算子 |
| `backend/prompts/creative/three_b_bending.yaml` | 旧 3B 算子 |
| `backend/prompts/creative/three_b_blending.yaml` | 旧 3B 算子 |
| `backend/creative_os/state_machine_three_b.py`(若存在) | 合并到 `three_b_engine.py` |
| `backend/api/three_b_routes.py` 中 `deepen` / `apply-concept` 端点 | 流程已废 / 合并到 advance |

---

## 7. 前端实现

### 7.1 组件结构

```
CreativeDivergenceStep.tsx (orchestrator)
├── StepIndicator.tsx (4 阶段,跳回非破坏)
├── ConfirmNextDialog.tsx (二次确认组件,用于任一阶段「下一步」)
└── 当前阶段组件:
    ├── S1InputStep.tsx (保留,基本不改)
    ├── S2DecomposeStep.tsx (新建)
    ├── S3DivergeStep.tsx (新建)
    └── S4CommitStep.tsx (新建)
```

### 7.2 状态机:`useThreeBDivergence` reducer

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
  causalMap: string;
  topLevelSummary: string;
  followUpLoadingUnitId: string | null;

  // Stage 3
  diverging: boolean;
  divergeError: string | null;

  // Stage 4
  committing: boolean;
  commitError: string | null;
  committedConcept: CommittedConcept | null;
  editingConcept: boolean;
  advancing: boolean;

  // 跳回二次确认
  pendingNextSubStage: SubStage | null;  // 非 null 时显示 ConfirmNextDialog
}

type Action =
  | { type: "HYDRATE"; state: Partial<State> }
  | { type: "STAGE1_SUCCESS"; intent: RawIntent }
  | { type: "DECOMPOSE_START" }
  | { type: "DECOMPOSE_SUCCESS"; dimensions, causalMap, topLevelSummary }
  | { type: "DECOMPOSE_ERROR"; message: string }
  | { type: "FOLLOW_UP_START"; unitId: string }
  | { type: "FOLLOW_UP_SUCCESS"; unit: Unit }
  | { type: "FOLLOW_UP_ERROR"; message: string }
  | { type: "DIVERGE_START" }
  | { type: "DIVERGE_SUCCESS"; dimensions }
  | { type: "DIVERGE_ERROR"; message: string }
  | { type: "REGENERATE_UNIT_SUCCESS"; dimension: DimensionDecomposition }
  | { type: "SELECT_UNIT_CANDIDATE"; unitId: string; candidateIndex: number }
  | { type: "COMMIT_START" }
  | { type: "COMMIT_SUCCESS"; committedConcept; noveltyScores }
  | { type: "COMMIT_ERROR"; message: string }
  | { type: "EDIT_CONCEPT_START" }
  | { type: "EDIT_CONCEPT_SUCCESS"; committedConcept }
  | { type: "EDIT_CONCEPT_CANCEL" }
  | { type: "ADVANCE_START" }
  | { type: "ADVANCE_SUCCESS"; committedAt: string }
  | { type: "JUMP_TO_STAGE"; stage: SubStage }  // 仅切 currentSubStage,不动数据
  | { type: "REQUEST_NEXT"; target: SubStage }  // 检查下游 → 弹 dialog 或直接 NEXT
  | { type: "CONFIRM_NEXT" }  // 用户确认清空下游 → dispatch 原始 NEXT action
  | { type: "CANCEL_NEXT" }
  | { type: "RESET" };
```

**关键 action 语义:**
- `JUMP_TO_STAGE`:StepIndicator 跳回,**不修改任何数据**
- `REQUEST_NEXT`:用户点「下一步」,reducer 检查 `state` 中下游数据(target stage 及其后):
  - 若有数据 → `pendingNextSubStage = target`,显示 dialog
  - 若无 → 立即 dispatch 原始 NEXT action(decompose/diverge/commit/advance)
- `CONFIRM_NEXT`:dialog 确认 → 清空下游 state 字段 + dispatch 原始 NEXT action
- `CANCEL_NEXT`:dialog 取消 → 留在当前阶段

### 7.3 S2DecomposeStep UX

```
┌──────────────────────────────────────────────────────────┐
│ Stage 2 · 第一性拆解 · 5 维度                              │
│ 顶部: causal_map (Markdown/ASCII 渲染)                    │
├──────────────────────────────────────────────────────────┤
│ ▾ 世界构成 (Ontology) · 核心洞察:本土天道 vs 异域天道...   │
│   ┌─ 灵窍 [Unit #abc123]                                 │
│   │  灵窍是修炼者与天地能量交互的接口...                   │
│   │  [追问] [已追问 2 次]                                 │
│   ├─ 本源 [Unit #def456]                                 │
│   │  ...                                                │
│   └─ ...                                                │
│                                                          │
│ ▾ 能量体系 (Energetics) · 核心洞察: 修炼体系的本质是...    │
│   ...                                                    │
│                                                          │
│ 底部: top_level_summary (≤150 字渲染)                      │
│                                                          │
│ [上一步: 输入]   [下一步: 发散 →]                         │
└──────────────────────────────────────────────────────────┘
```

**追问按钮:**
- 单元 `is_irreducible=true` 时按钮 disabled,文字"已不可再分"
- 否则点击弹出 PromptDialog(单 input + 取消/确认);空提交 = 调用 follow-up prompt 的默认追问
- 追问中按钮显示 loading,整个 unit 卡片半透明

### 7.4 S3DivergeStep UX

```
┌──────────────────────────────────────────────────────────┐
│ Stage 3 · 自适应发散 · per-unit 自适应路由                  │
│ [全部重新生成]                                            │
├──────────────────────────────────────────────────────────┤
│ ▾ 世界构成                                                │
│   ┌─ 灵窍 [Unit #abc123]                                 │
│   │  主算子: 扭曲 · 辅算子: 打破                          │
│   │  ○ 候选 A: 灵窍裂变为多个子接口...                     │
│   │    连锁推演: 修炼者需协调多接口,接口间能量冲突引发... │
│   │  ● 候选 B: 灵窍是量子纠缠态...                        │
│   │    连锁推演: ...                                    │
│   │  [重新生成该单元]                                    │
│   ├─ 本源 [Unit #def456]                                 │
│   │  ...                                                │
│   │                                                      │
│ ▾ 能量体系                                                │
│   ┌─ 修行 [Unit #789xyz]                                 │
│   │  该单元暂不可用(发散失败)                            │
│   │  [重新生成该单元]                                    │
│                                                          │
│ [上一步: 拆解]   [下一步: 提交 →]                         │
└──────────────────────────────────────────────────────────┘
```

- 候选切换走 POST `/select-unit`(纯本地操作,无 LLM)
- 「重新生成该单元」走 POST `/regenerate-unit`
- 「全部重新生成」走 POST `/diverge`
- 进入 S3 时若 `dimensions[].candidates` 已存在,**不自动重跑**(让用户能继续编辑)

### 7.5 S4CommitStep UX

```
┌──────────────────────────────────────────────────────────┐
│ Stage 4 · 提交                                            │
├──────────────────────────────────────────────────────────┤
│ 显示模式(committedConcept 非空):                          │
│   one_line: 修炼者掌握双规则体系的觉醒之路                  │
│   expanded: ...                                          │
│   core_tension: ...                                      │
│   tone: 暗黑悬疑                                          │
│   logline: ...                                           │
│   [用户已编辑] (edited_by_user=true 时显示)               │
│   [新颖度评分] composite: 60 B+                           │
│                                                          │
│   [编辑] [重新生成] [全部重新生成]                        │
│   (重新生成按钮二次确认 dialog)                            │
│                                                          │
│ 空态(committedConcept 为 null):                           │
│   尚未合成 concept,点「下一步」将开始 LLM 合成              │
│                                                          │
│ 编辑模式:                                                 │
│   one_line: [textarea]                                   │
│   expanded: [textarea × 200 字]                          │
│   ...                                                    │
│   [保存编辑] [取消编辑]                                  │
│                                                          │
│ [下一步: 进入概念DNA →]                                   │
└──────────────────────────────────────────────────────────┘
```

- 「重新生成」→ POST `/commit`(二次确认,防覆盖已编辑版本)
- 「全部重新生成」→ POST `/diverge` + 跳回 S3
- 「编辑」→ 切到编辑模式,内部 React state,不立即调 API
- 「保存编辑」→ POST `/edit-concept`,回到显示模式,显示「用户已编辑」
- 「下一步」→ POST `/advance`(内部先调 `/commit` 若 committedConcept 为 null)

### 7.6 Hydrate 与 v1 toast

```typescript
useEffect(() => {
  let cancelled = false;
  api.getThreeBState(projectId).then((s) => {
    if (cancelled) return;
    if (s === null) {
      // v1 文件已被迁移删除,或首次进入
      dispatch({ type: "HYDRATE", state: { currentSubStage: "1", completedSubStages: [] } });
      // 一次性 toast(组件级 state,不持久)
      setShowUpgradeToast(true);
      return;
    }
    // v2 正常 hydrate
    const completed: SubStage[] = ["1"];
    if (s.dimensions.length > 0) completed.push("2");
    if (s.dimensions.some((d) => d.candidates.length > 0)) completed.push("3");
    if (s.committed_concept !== null) completed.push("4");
    dispatch({
      type: "HYDRATE",
      state: {
        rawIntent: s.raw_intent,
        dimensions: s.dimensions,
        causalMap: s.causal_map,
        topLevelSummary: s.top_level_summary,
        committedConcept: s.committed_concept,
        currentSubStage: s.committed_concept ? "4"
          : s.dimensions.some((d) => d.candidates.length > 0) ? "3"
          : s.dimensions.length > 0 ? "2"
          : "1",
        completedSubStages: completed,
      },
    });
  });
  return () => { cancelled = true; };
}, [projectId]);
```

### 7.7 StepIndicator 跳回语义

```tsx
const onStageClick = (stage: SubStage) => {
  // 仅切 UI state,不动数据(N4 后向跳转非破坏)
  dispatch({ type: "JUMP_TO_STAGE", stage });
};
```

- 已完成的阶段可跳回
- 当前阶段不可再点
- 未达不可点

### 7.8 文件清单

| 文件 | 操作 |
|---|---|
| `frontend/src/components/wizard/divergence_v2/types.ts` | **重写** 移除 Candidate / DeepenedCandidate / RawIntent(沿用),新增 Dimension / Unit / UnitCandidate(加 chain_reaction/main_operator/aux_operator) / DimensionDecomposition(加 insight) / ThreeBState(加 causal_map/top_level_summary) |
| `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` | 保留(几乎不改) |
| `frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx` | **删除** |
| `frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx` | **删除** |
| `frontend/src/components/wizard/divergence_v2/S2DecomposeStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/S4CommitStep.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/ConfirmNextDialog.tsx` | **新建** |
| `frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts` | **重写** 加 JUMP_TO_STAGE / REQUEST_NEXT / CONFIRM_NEXT / CANCEL_NEXT actions |
| `frontend/src/components/wizard/divergence_v2/StepIndicator.tsx` | 改 SUB_STAGES 为 4 项 + onStageClick 调 JUMP_TO_STAGE |
| `frontend/src/api/client.ts` | 10 个方法对应 10 个新端点(无 apply-concept,加 advance) |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | 适配 onAdvanceSuccess → 通知 WizardContext step 1 完成 |

---

## 8. UX 规则汇总

| 场景 | 行为 |
|---|---|
| StepIndicator 点击已完成阶段 | `JUMP_TO_STAGE`,仅切 UI state(N4) |
| 任一阶段「下一步」点击 | `REQUEST_NEXT`:检查下游数据,有则弹 dialog,无则直接执行 |
| 下游有数据,用户确认 dialog | 清空下游 state 字段 + 执行该阶段正常动作(decompose/diverge/commit/advance) |
| 下游有数据,用户取消 dialog | 留在当前阶段,state 不变 |
| S2 进入时 `dimensions=[]` | 自动触发 `/decompose` |
| 追问时 `is_irreducible=true` | 422 → UI 显示 inline error "该单元已不可约化" |
| 追问时 LLM 失败 | 显示 "追问失败,可重试" + 重试按钮 |
| S3 进入时全部 unit 失败 | 顶部红色 banner + 「全部重新生成」可点 |
| S3 单 unit 失败 | 该 unit 卡片显示"该单元暂不可用",其他 unit 正常 |
| S4 「重新生成」点击 | 二次确认 dialog(防误覆盖已编辑版本) |
| S4 「全部重新生成」点击 | 跳回 S3 + 重跑 `/diverge` |
| S4 「编辑」→ 「保存编辑」后 | 显示「用户已编辑」标签 |
| S4 「下一步」+ committedConcept 为 null | 内部自动调 `/commit` → `/advance` → 通知 wizard |
| S4 「下一步」+ committedConcept 非空 | 直接调 `/advance`(写入编辑版或原版) |
| 任何阶段网络 503 | 显示 "操作失败,可重试" + 重试按钮,不丢失当前 state |
| v1 文件加载 | toast「创意发散已升级到 4 阶段流程,旧版本已清除」 |

---

## 9. 测试覆盖

### 9.1 后端

| 文件 | 覆盖 |
|---|---|
| `tests/test_creative_os/test_three_b_engine.py` | 6 方法(decompose / follow_up_unit / diverge / regenerate_unit / select_unit_candidate / commit / edit / advance)happy path + 异常 + asyncio.gather 失败降级 |
| `tests/test_creative_os/test_three_b_migration.py` | v1→v2 两场景(无 v1 文件 / 有 v1 文件 → 删文件返回 None) |
| `tests/test_creative_os/test_three_b_state.py` | atomic_write_state 沿用现有测试 |
| `tests/test_api/test_three_b_routes.py` | 10 端点契约 + 422/404/503 错误码 |
| `tests/test_prompts/test_three_b_yaml.py` | 4 YAML schema 校验(原 3B yaml 已删,只校验新 4 个);decompose 输出 schema 校验(5 dim × N units + causal_map + summary) |
| `tests/test_creative_os/test_three_b_diverge_unit.py` | 自适应发散 prompt 结构校验:4 算子都出现在 prompt + chain_reaction 字段强制输出 |

### 9.2 前端

| 文件 | 覆盖 |
|---|---|
| `test/wizard/divergence_v2/S2DecomposeStep.test.tsx` | 5 维度渲染 + insight header + causal_map 底部 + 追问按钮 + 不可约化 disabled |
| `test/wizard/divergence_v2/S3DivergeStep.test.tsx` | 候选 radio 切换 + chain_reaction 显示 + 单 unit 重新生成 + 全部重新生成 + 失败 unit banner |
| `test/wizard/divergence_v2/S4CommitStep.test.tsx` | 5 字段展示 + 编辑保存 + 重新生成二次确认 + 全部重新生成跳回 S3 + 「下一步」advance |
| `test/wizard/divergence_v2/StepIndicator.test.tsx` | 4 阶段 jump 规则(跳回非破坏) |
| `test/wizard/divergence_v2/ConfirmNextDialog.test.tsx` | 二次确认 dialog 流程(确认/取消各路径) |
| `test/wizard/divergence_v2/useThreeBDivergence.test.ts` | reducer 状态转换(JUMP / REQUEST_NEXT / CONFIRM_NEXT 序列) |
| `test/wizard/CreativeDivergenceStep.test.tsx` | 重写为 4 阶段 orchestrator + v1 toast |

---

## 10. 验收标准

1. **流程可走通:** 4 阶段全部成功后,`<project>/concept_and_dna.json` 与 `creative_divergence.json` 内容字段齐备(含 novelty_scores),`stage2_world_char.py` 可正常读取。
2. **追问生效:** 对任一 unit 追问一次后,刷新页面 hydrate,description 已更新,`follow_up_count` 增加,`is_irreducible` 状态保留。
3. **追问不可约化:** unit `is_irreducible=true` 时追问按钮 disabled,直接调用 API 返回 422。
4. **发散失败降级:** mock 5 维度共 20 units 中 5 个 LLM 抛异常,其余 15 个返回正常候选,UI 显示该 5 个为"该单元暂不可用",其余可正常切换。
5. **编辑保存:** 用户编辑 → 保存 → 刷新页面,显示「用户已编辑」,`edited_by_user=true`,`concept_and_dna.json` **未变更**。
6. **advance 生效:** 用户编辑 → 保存 → 「下一步」→ `concept_and_dna.json` 内容已包含编辑版本,`novelty_scores` 顶层写入,`three_b_snapshot.committed_at` 更新。
7. **v1 迁移:** 模拟 v1 state 文件 → 加载后 state 为 None + 文件已删 + toast 显示。
8. **跳回非破坏:** S4 → StepIndicator 跳回 S2 → S2 数据完整,S3 候选完整,S4 committedConcept 完整,无 API 调用。
9. **下一步二次确认:** S3 → 「下一步」时 committedConcept 非空 → 弹 dialog → 取消 → 留在 S3;确认 → 清空 committedConcept + 进入 S4。
10. **旧算子 yaml 删除:** `git grep three_b_breaking` 在 `backend/prompts/creative/` 无命中。
11. **commit 拒绝:** mock 17 units 都失败 → `/commit` 返回 422 COMMIT_INSUFFICIENT。
12. **自适应引擎字段:** `UnitCandidate` 输出包含 `main_operator / aux_operator / chain_reaction` 三个字段,缺一则视为 LLM 失败。
13. **测试通过:** 后端 `pytest tests/test_creative_os/test_three_b*.py tests/test_api/test_three_b_routes.py tests/test_prompts/test_three_b_yaml.py` 全绿;前端 `npm test` 全绿。
14. **类型一致:** 前端 `types.ts` 与后端 dataclass 字段名一一对应(snake_case 转换在 API 边界完成)。

---

## 11. 范围外 (Out of Scope)

- 追问历史的撤销/版本树(只保留计数)
- 自动检测"不可约化"(完全由 LLM 标记,无保险丝)
- 多语言 i18n 框架(中文标签硬编码)
- Stage 2 维度数量自适应(固定 5 维度)
- 单元数量自适应(每维度 3-5 单元由 LLM 决定,但不加约束)
- 组合链的 3 步复合调用(LLM 自报但实际单步,N1=b)
- 旧 Path B `/creative-divergence/*` 接口改造(deprecation header 继续生效)
- Prompt Plaza UI 改造(YAML 自动发现已生效,无需改前端)

---

## 12. 实施依赖与顺序

1. **Step 1**:新建 4 个 prompt YAML(decompose / follow_up / adaptive_diverge / commit 修改)+ 删除 3 个旧算子 YAML
2. **Step 2**:重写 `three_b_engine.py` dataclass + engine 方法(新增 `advance`,删除 `apply_committed_concept`,diverge 改为 per-unit 自适应)
3. **Step 3**:重写 `three_b_routes.py`(10 端点,删除 `apply-concept`,加 `advance`)
4. **Step 4**:实现 v1→v2 迁移逻辑(migrate_state_on_load 简化为删文件 + 返回 None)
5. **Step 5**:重写前端 `types.ts` + 新建 3 个步骤组件 + reducer 重写 + StepIndicator 改 4 阶段 + ConfirmNextDialog
6. **Step 6**:更新 `api/client.ts`(10 方法)
7. **Step 7**:写测试(后端 6 文件 + 前端 7 文件)
8. **Step 8**:v1 迁移手动验证 + 端到端 happy path + LLM 调用实际跑通 + 跳回 + 二次确认 + 失败降级全场景验证