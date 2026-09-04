# 创意发散 3B 三阶段重构 Spec

> 参考框架:[`/docs/design/3B创造力法则应用指南.md`](../design/3B创造力法则应用指南.md)（打破 Breaking / 扭曲 Bending / 融合 Blending 三算子法则）。
> 上游 spec:[`2026-08-30-creative-divergence-refactor-design.md`](./2026-08-30-creative-divergence-refactor-design.md)（已实现 5 阶段线性流程 + 路由统一,本 spec 在其基础上做 3B 改造 + 清理）。
> 范围:Wizard 侧「创意发散」5 阶段→3 阶段重构 + 清理 2026-09-03 引入的 Canvas 双轨集成。
> 不在范围:Canvas 独立页面 `/project/:id/canvas` 的功能改造、Canvas 内部状态机、3B 算法在其他模块的复用。

---

## 1. 背景与目标

### 1.1 当前 gap

Wizard 侧栏第一项「创意发散」(CreativeDivergenceStep) 走 5 阶段线性流程（A 输入 → B 变体 → C 矛盾 → D 展开 → E 提交）。5 阶段流程存在以下问题:

| 问题 | 用户表现 | 根因 |
|---|---|---|
| 阶段间语义不清 | 用户不知道 B/C/D 各代表什么创作动作 | 命名沿用引擎能力名(mutation/contradiction/whatif),不是创作意图名 |
| 阶段间串行处理过早收窄 | 一次只能看 3 个变体,看不到「如果走别的方向会怎样」 | B 阶段把 mutation_chain 串行,3 个变体不交叉 |
| 5 阶段操作类型不统一 | 用户需学 4 套不同 UI(变体卡/矛盾候选/分叉树/新颖度雷达) | 每阶段接一个不同引擎,UI 各自演化 |
| 5 阶段未提供「按创作意图选方向」的入口 | 用户想要「让设定更极端」时不知道该走 B/C/D 哪个 | 引擎能力(扭曲/打破/融合)在产品层未显式抽象 |

### 1.2 3B 重构目标

| 目标 | 验收标准 |
|---|---|
| **5 阶段→3 阶段简化** | 用户走完 3 阶段(input / 并行发散 / 深化)即得到 concept_and_dna |
| **按 3B 算子统一阶段 2** | 打破 / 扭曲 / 融合三个算子并行触发,LLM 自主选 3-5 子维度,产出 9-15 个并列候选 |
| **阶段 3 = 二次算子叠加** | 用户选 1-3 个候选,各追加一个不同 3B 算子,深化产出 1-3 个最终点子 |
| **3B prompt 在 Prompt Plaza 可查可改** | `three_b_breaking` / `three_b_bending` / `three_b_blending` / `three_b_commit` 4 条 entry 出现在 Prompt Plaza 列表,支持在线编辑 |
| **彻底清理 2026-09-03 Canvas 双轨集成** | WizardSidebar 不再展示「divergence + canvas」OR 语义的并列 step 1;`activeStep1Surface` / `completedStep1Surfaces` 等状态彻底删除 |
| **下游消费者零改动** | concept_and_dna.json / creative_divergence.json schema 不变,Stage 1 / Stage 2 / Stage 4 等下游模块零迁移 |

### 1.3 不在范围

- Canvas 独立页面 `/project/:id/canvas` 的功能改造(保留为独立创意画布入口,但不再挂在 wizard 下)
- 3B 算法在 Stage 4 写作、NPC 设计等其他模块的复用(后续 spec)
- 老 5 阶段流程的旧项目数据迁移(读取时探测 + 引导用户重新发散即可)
- 阶段 1 输入的 genre 融合特殊入口(3B 已自带融合算子,不再需要)

---

## 2. 顶层架构

```
                    ┌─────────────────────────────────┐
                    │  WorkspaceWizardPanel (step 1)  │
                    │  CreativeDivergenceStep (3 阶段)│
                    │  ├ S1InputStep                  │
                    │  ├ S2DivergenceStep             │
                    │  └ S3DeepenStep                 │
                    └──────────┬──────────────────────┘
                               │ HTTP
                               ▼
        ┌──────────────────────────────────────────┐
        │ /api/v1/projects/{id}/creative/diverge/  │
        │   three-b/*                              │
        │ ┌────────┬────────┬──────────┬────────┐  │
        │ │diverge │ deepen │ regenerate│commit  │  │
        │ │ state  │        │           │        │  │
        │ └────────┴────────┴───────────┴────────┘  │
        │                                          │
        │ Engine: ThreeBEngine                     │
        │ Prompt: 3 个算子级 YAML + 1 个 commit    │
        └──────────┬───────────────────────────────┘
                               │ 写
                               ▼
        ┌─────────────────────────┐
        │ three_b_state.json      │
        │ concept_and_dna.json    │
        │ creative_divergence.json│
        └─────────────────────────┘
```

### 2.1 设计原则

1. **状态文件独立**:3B 数据走 `three_b_state.json`,不动 canvas_state.json(schema 隔离,避免 v3→v4 迁移式痛苦,参 memory `project_canvas_v3v4_migration_additive`)
2. **算子并行**:Stage 2 三个算子 LLM 调用通过 `asyncio.gather` 真并行,`Semaphore(3)` 防突发
3. **Prompt Plaza 透明**:4 个 3B prompt 注册到 `prompt_defaults.py`,用户在线编辑生效(3-tier override)
4. **下游兼容**:commit 端点照旧写 concept_and_dna.json + creative_divergence.json(同 schema),Stage 1 ConceptStep 等下游零改动
5. **Canvas 路径解耦**:Canvas 独立页面与 wizard「创意发散」完全解耦,数据互不交叉

---

## 3. 数据 Schema

### 3.1 three_b_state.json

```json
{
  "schema_version": 1,
  "project_id": "proj_xxx",
  "raw_intent": {
    "prompt": "修仙对抗外星文明",
    "genre_primary": "修仙",
    "genre_secondary": "星际"
  },
  "stage1": {
    "completed_at": "2026-09-04T12:00:00",
    "source": "creative_divergence"
  },
  "stage2": {
    "started_at": "2026-09-04T12:01:00",
    "completed_at": "2026-09-04T12:02:30",
    "candidates": [
      {
        "id": "cand_a1b2",
        "operator": "breaking",
        "sub_dimension": "打破线性/时间顺序",
        "sub_dimension_index": 0,
        "premise_one_line": "倒叙展开:主角先发现结局,再回到原点重新走过",
        "rationale": "如果故事一开始就把最终揭露的真相摆在读者面前,再倒回去展示主角一步步走向那个揭露...",
        "novelty_hook": "信息倒置造成的悬念重排",
        "recognition_score": 0.7,
        "strangeness_score": 0.6,
        "llm_raw": "{...}",
        "regenerated_count": 0
      }
    ]
  },
  "stage3": {
    "deepened": [
      {
        "id": "deep_x9y8",
        "source_candidate_id": "cand_a1b2",
        "source_operator": "breaking",
        "applied_operator": "bending",
        "applied_sub_dimension": "尺度扭曲",
        "applied_sub_dimension_index": 0,
        "premise_one_line": "把整个倒叙宇宙压缩到主角的梦境长度内(一个呼吸之间完成全篇倒叙)",
        "rationale": "把打破线性后的故事再尺度扭曲——不是一整本书的倒叙,而是一夜之间的倒叙...",
        "novelty_hook": "梦境密度的全篇倒叙",
        "recognition_score": 0.8,
        "strangeness_score": 0.85,
        "llm_raw": "{...}",
        "deepen_count": 0
      }
    ]
  },
  "committed": false,
  "committed_at": null
}
```

字段要点:
- `schema_version: 1` 与 canvas_state v3/v4 完全隔离
- `stage2.candidates[]` 持久化所有并行发散产出,供 Stage 3 选择
- `stage3.deepened[]` 持久化深化候选,可继续追加(单候选 deepen_count 上限 5)
- 写盘走 atomic `.tmp + replace`(与 autopilot_session.json 一致)
- 不存 selected_path(树状概念弃用),改为「候选 ID 数组」扁平结构

### 3.2 写盘辅助路径

```
<project>/
├── creative_os/
│   ├── canvas_state.json          (不动,Canvas 独立使用)
│   └── three_b_state.json         (新增,本 spec 主数据)
├── concept_and_dna.json           (commit 时由 ThreeBEngine 写)
└── creative_divergence.json       (commit 时由 ThreeBEngine 写,兼容 schema)
```

---

## 4. 后端设计

### 4.1 API 端点

#### `POST /creative/diverge/three-b/diverge`

Stage 1→2 一次性触发。3 算子**真并行**发散。

**Request**:
```json
{
  "prompt": "string (≥10字)",
  "genre_primary": "string",
  "genre_secondary": "string | null"
}
```

**Response**:
```json
{
  "candidates": [
    { "id": "cand_a1b2", "operator": "breaking", "sub_dimension": "...",
      "premise_one_line": "...", "rationale": "...",
      "novelty_hook": "...", "recognition_score": 0.7, "strangeness_score": 0.6 }
  ],
  "by_operator": {
    "breaking": [/* 3-5 */],
    "bending":  [/* 3-5 */],
    "blending": [/* 3-5 */]
  },
  "elapsed_ms": 12340
}
```

**实现要点**:
- `asyncio.gather(_call_operator(breaking), _call_operator(bending), _call_operator(blending))` 真并行
- `Semaphore(3)` 限流,防 LLM 突发
- `return_exceptions=True`:任一算子失败 → 该算子返回空 list,其他正常
- 全部 gather 完成 → 一次性写 `three_b_state.json`
- raw_intent 同时保留在 state(供 Stage 3 commit 复用)

#### `POST /creative/diverge/three-b/deepen`

Stage 2→3 单候选深化。

**Request**:
```json
{ "candidate_id": "cand_a1b2", "applied_operator": "bending" }
```

**Response**:
```json
{
  "deepened": {
    "id": "deep_x9y8",
    "source_candidate_id": "cand_a1b2",
    "source_operator": "breaking",
    "applied_operator": "bending",
    "applied_sub_dimension": "尺度扭曲",
    "premise_one_line": "...",
    "rationale": "...",
    "novelty_hook": "...",
    "recognition_score": 0.8,
    "strangeness_score": 0.85
  }
}
```

**约束**:
- `applied_operator` 必须 ≠ `source_operator`(前端禁用 + 后端 422)
- 同一候选可多次 deepen(追加而非替换),`deepen_count` 累加
- 单次 1 个 LLM 调用,不并行
- 写盘:追加到 `stage3.deepened[]`

#### `POST /creative/diverge/three-b/commit`

Stage 3 提交,LLM 合成 concept + Novelty 评分。

**Request**:
```json
{ "deepened_ids": ["deep_x9y8", "deep_p7q2", "deep_m3n4"] }
```

**Response**:
```json
{
  "concept_and_dna": {
    "one_line": "...",
    "expanded": "...",
    "core_tension": "...",
    "tone": "...",
    "logline": "..."
  },
  "novelty_scores": {
    "market_saturation": 30,
    "trope_similarity": 25,
    "contradiction_depth": 80,
    "discussion_potential": 70,
    "composite": 60,
    "grade": "B+"
  },
  "message": "概念已写入 concept_and_dna.json"
}
```

**实现要点**:
- `deepened_ids` 长度约束 1 ≤ n ≤ 3(前端禁用 + 后端 422)
- 读 `three_b_state.json` 的 `stage3.deepened[]`,按 ID 过滤
- 调 `three_b_commit.yaml` prompt,LLM 合成单一 concept
- 复用 `NoveltyEvaluator` 跑 4 维评分
- 写盘三件套:
  1. `concept_and_dna.json` — 单一合成概念
  2. `creative_divergence.json` — 完整三阶段历史(同 schema,`source="creative_divergence"`)
  3. `three_b_state.json` 设 `committed: true` + `committed_at`

#### 辅助端点

| Method | Path | 用途 |
|---|---|---|
| `GET /creative/diverge/three-b/state` | 读 `three_b_state.json`(前端 mount hydrate) |
| `DELETE /creative/diverge/three-b/state` | 重置(删文件),「重新发散」按钮 |
| `POST /creative/diverge/three-b/regenerate-candidate` | 单候选重新生成(保持 id,`regenerated_count++`) |

### 4.2 ThreeBEngine 类

```python
# backend/creative_os/three_b_engine.py

class ThreeBEngine:
    """3B 创造力法则专用引擎。

    三阶段:
      - diverge(): Stage 1→2 并行广度优先发散,3 算子 × 各自 3-5 子维度
      - deepen(): Stage 2→3 单候选二次算子深化
      - commit(): Stage 3 提交,LLM 合成 concept + Novelty 评分
    """

    OPERATORS = ("breaking", "bending", "blending")

    async def diverge(self, project_id: str, raw_intent: dict) -> dict:
        """3 个算子 asyncio.gather 并行发散,返回 candidates + by_operator。"""

    async def deepen(
        self,
        project_id: str,
        candidate_id: str,
        applied_operator: str,
    ) -> dict:
        """单候选二次算子深化,追加到 state.stage3.deepened[]。"""

    async def commit(
        self,
        project_id: str,
        deepened_ids: list[str],
    ) -> dict:
        """LLM 合成单一 concept,落盘 3 个文件。"""

    # 私有辅助
    async def _call_operator(
        self, operator: str, raw_intent: dict
    ) -> list[dict]:
        """单算子 LLM 调用,prompt 内含子维度清单 + 选 3-5 个指令。"""

    def _load_prompt(self, operator: str) -> PromptSpec:
        """从 backend/prompts/creative/three_b_<operator>.yaml 加载。
        经 PromptPlaza 3-tier override 解析(YAML → Global → Project)。
        """

    def _coerce_candidate(self, raw: dict, operator: str) -> Candidate:
        """LLM 输出字段缺失/类型异常时,默认值兜底。"""
```

**关键依赖**:
- `backend/llm/model_router.py` — Tier 1 (creative core) 模型路由
- `backend/services/prompt_override_store.py` — 3-tier 覆盖读 prompt
- `backend/utils/file_manager.py` — atomic write
- `asyncio.Semaphore(3)` — 防 LLM 突发

### 4.3 Prompt 结构(3 个算子级 + 1 个 commit)

以 `three_b_breaking.yaml` 为例(其他两个结构相同,替换子维度清单):

```yaml
name: three_b_breaking
provider: default
model: default
temperature: 0.9
max_tokens: 4096

system_prompt: |
  你是一位小说创意发散顾问,专长「打破」算子——把既有结构(线性/因果/边界/视角/功能)的秩序破坏,让熟悉的设定产生陌生感。

  ## 打破算子的 5 个子维度

  1. **打破线性/时间顺序** —— 倒叙、跳跃、循环、多线交织
     提问模板: "如果这件事不是按原来的先后顺序发生/揭示,会怎样?"
     小说应用举例: 打乱时间线叙事、记忆倒流的角色、结果先于原因出现的世界规则

  2. **打破因果/逻辑规则** —— 移除或反转"A 导致 B"的因果链
     提问模板: "如果这个世界里,通常成立的因果关系在某个局部失效了,会怎样?"
     小说应用举例: 付出没有回报的魔法体系、死亡不是终点而是开始的世界观

  3. **打破边界/分类** —— 拆掉默认分隔(生/死、人/物、内/外、真实/虚构)
     提问模板: "如果这两者之间原本清晰的界限出现了裂缝,会漏出什么?"
     小说应用举例: 梦境会渗入现实的建筑、身份证明失效的世界

  4. **打破视角/维度** —— 改变叙事默认所处的视角/维度/尺度
     提问模板: "如果换一个不被期待的观察者/维度来呈现这个设定,会怎样?"
     小说应用举例: 物件视角叙事、二维生物眼中的三维事件、群体意识而非个体视角

  5. **打破功能/用途预期** —— 拿掉物件/角色"应该"承担的功能
     提问模板: "如果这个东西/角色不再承担它原本的功能,而是被用于完全无关的目的,会怎样?"
     小说应用举例: 武器变成乐器、法官变成罪犯的辩护人、圣物被日常化使用

  ## 输出检验标准

  打破后的点子应该让人感到"原本秩序中出现了一道裂缝"——结构仍可辨认,但顺序/逻辑/边界已经不再成立。

  ## 任务

  根据用户提供的原始创意点子,从这 5 个子维度中**选出最相关且产出潜力最大的 3-5 个**,
  对每个选中的子维度产出 1 个具体点子。
  不要试图覆盖全部 5 个——只为这个具体创意值得展开的子维度写点子。
  输出严格 JSON,不要任何额外文字。

  {negative_constraints}

user_prompt_template: |
  原始创意点子: {prompt}
  主类型: {genre_primary}
  副类型(可选): {genre_secondary}

  请针对这个创意,选 3-5 个最值得展开的「打破」子维度,每个产出 1 个具体点子。
  输出 JSON 数组,每个元素:
  {{
    "sub_dimension": "子维度名(从 5 个里选)",
    "premise_one_line": "变异后的核心前提(50-100字)",
    "rationale": "为什么这个子维度适合这个创意 + 怎样打破(50-100字)",
    "novelty_hook": "吸引读者的新颖点(30-50字)"
  }}

output_format:
  type: json
```

`three_b_bending.yaml` 与 `three_b_blending.yaml` 结构相同,子维度清单按各自 6 个替换:
- 扭曲 6 子维度:尺度 / 速度 / 数量 / 强度 / 材质 / 方向
- 融合 6 子维度:物种 / 系统 / 身份 / 风格 / 文化 / 抽象具象

`three_b_commit.yaml` 是 Stage 3 合成 prompt,与上面不同:
- 输入:1-3 个深化候选 + 原始 prompt + 类型
- 输出:单一 `concept_and_dna` JSON(`one_line` / `expanded` / `core_tension` / `tone` / `logline`)

### 4.4 Prompt Plaza 注册

修改 `backend/services/prompt_defaults.py`,追加 4 条 entry:

```python
{
    "name": "three_b_breaking",
    "category": "creative",
    "description": "3B 创造力法则 — 打破算子(5 子维度:线性/因果/边界/视角/功能)",
    "default_path": "backend/prompts/creative/three_b_breaking.yaml",
},
{
    "name": "three_b_bending",
    "category": "creative",
    "description": "3B 创造力法则 — 扭曲算子(6 子维度:尺度/速度/数量/强度/材质/方向)",
    "default_path": "backend/prompts/creative/three_b_bending.yaml",
},
{
    "name": "three_b_blending",
    "category": "creative",
    "description": "3B 创造力法则 — 融合算子(6 子维度:物种/系统/身份/风格/文化/抽象具象)",
    "default_path": "backend/prompts/creative/three_b_blending.yaml",
},
{
    "name": "three_b_commit",
    "category": "creative",
    "description": "3B Stage 3 提交 — 1-3 个深化候选合成 concept_and_dna",
    "default_path": "backend/prompts/creative/three_b_commit.yaml",
},
```

Prompt Plaza 加载时显示这 4 条 entry,用户可在线编辑;保存走现有 3-tier override 机制。

### 4.5 错误处理

| 场景 | 处理 |
|---|---|
| LLM 返回非 JSON | 单算子失败,该算子返回空 list;前端展示 banner「X 算子暂不可用」;不影响其他算子 |
| LLM 返回字段缺失 | `_coerce_candidate()` 默认值兜底;warn 日志 |
| 3 个算子全部失败 | 返回 503;前端展示「生成失败,请重试」+ retry 按钮 |
| Stage 3 提交 deepened_ids 引用不存在的 ID | 422 + 列出 missing IDs |
| three_b_state.json 写盘失败 | 抛出异常,前端 toast;state 不变(下次 mount 重试) |
| Deepen 时 `applied_operator == source_operator` | 422 + 提示「必须选择不同的算子」 |
| 单算子 LLM 超时 30s | gather `return_exceptions=True` 兜底;该算子空 list 返回 |
| 同项目并发 `/three-b/diverge` | 后端 `asyncio.Lock(project_id)` 串行化;写盘 atomic tmp+replace |

---

## 5. 前端设计

### 5.1 组件树

```
CreativeDivergenceStep (顶层 orchestrator, 替换现有文件)
├─ useThreeBDivergence()  hook — 状态 + 副作用
├─ StepIndicator (3 阶段: 1. 输入 / 2. 发散 / 3. 深化)
├─ S1InputStep           — 灵感输入(原 S0A 简版,去掉融合 checkbox)
├─ S2DivergenceStep      — 3 列分组展示候选
│   ├─ OperatorColumn × 3 (breaking / bending / blending)
│   │   └─ CandidateCard × N (3-5 个)
│   └─ LoadingState + ErrorBanner
├─ S3DeepenStep          — 选候选 + 选二次算子 + 提交
│   ├─ SelectedCandidateList (来自 Stage 2)
│   ├─ OperatorPicker (单选,排除 source_operator)
│   ├─ DeepenedResultCard (深化后实时展示)
│   └─ CommitPanel (新颖度评分 + 提交按钮)
└─ RegenerateModal (复用现有 shared/RegenerateModal)
```

### 5.2 顶层状态机

```typescript
type SubStage = "1" | "2" | "3";

interface ThreeBDivergenceState {
  // 阶段控制
  currentSubStage: SubStage;
  completedSubStages: SubStage[];

  // Stage 1
  rawIntent: RawIntent | null;
  stage1Submitting: boolean;

  // Stage 2
  stage2Loading: boolean;
  candidates: Candidate[];
  stage2Error: string | null;

  // Stage 3
  stage3SelectedIds: string[];
  stage3AppliedOperators: Record<string, string>;  // candidateId -> applied_operator
  stage3Deepened: DeepenedCandidate[];
  stage3DeepenLoading: boolean;

  // Commit
  committing: boolean;
  commitResponse: CommitResponse | null;
  commitError: string | null;
}
```

**reducer actions**:
- `setRawIntent(intent)` / `clearRawIntent()`
- `submitStage1Success()` — 进入 Stage 2 加载态
- `stage2Success(candidates)` / `stage2Error(msg)` / `stage2Retry()`
- `toggleStage3Select(candidateId)` / `setStage3Operator(candidateId, op)` / `clearStage3Selection()`
- `deepenSuccess(deepened)` / `deepenError(msg)`
- `commitStart()` / `commitSuccess(response)` / `commitError(msg)`
- `hydrateFromServer(state)` — 页面 mount 时从 `/three-b/state` 读

### 5.3 S1InputStep

简化现有 `S0AInputStep`:
- 去掉「启用融合」checkbox(3B 已自带融合算子,不再需要 genre 融合的特殊入口)
- 保留:prompt (≥10字) + 主类型下拉 + 副类型下拉(可选)
- 提交按钮:「开始 3B 发散」(替代原「下一步:生成变体」)
- 提交后:清空 state,调用 `/three-b/diverge`,进入 Stage 2

### 5.4 S2DivergenceStep

布局:3 列网格(`md:grid-cols-3`),每列一个算子。

```
┌──────────────────────────────────────────────────────┐
│ 3B 并行发散结果 · 共 12 个候选(破 4 / 扭 4 / 融 4)   │
├──────────────────┬──────────────────┬──────────────────┤
│ 🔨 打破(4)        │ 〰️ 扭曲(4)        │ 🌀 融合(4)        │
├──────────────────┼──────────────────┼──────────────────┤
│ [打破线性]        │ [尺度扭曲]        │ [物种融合]        │
│ 倒叙展开...       │ 城市大小生物...   │ 半机械半植物...   │
│ 新颖点: 信息倒置  │ 新颖点: 巨型文明  │ 新颖点: 复合生命  │
│ □ 选择            │ □ 选择            │ □ 选择            │
├──────────────────┼──────────────────┼──────────────────┤
│ [打破因果]        │ [速度扭曲]        │ [系统融合]        │
│ ...              │ ...              │ ...              │
│ □ 选择            │ □ 选择            │ □ 选择            │
└──────────────────┴──────────────────┴──────────────────┘
       [重新生成]              [下一步:深化(已选 2/3)]
```

**CandidateCard** props:
```typescript
interface CandidateCardProps {
  candidate: Candidate;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}
```

**选择规则**:
- 跨算子总计 1-3 个
- 已选 3 个时其他 card 禁用 checkbox + opacity-50
- 底部 sticky bar:实时显示「已选 N / 3」+ 「下一步:深化」按钮

**重新生成**:
- 单卡「再生成」→ 调 `/three-b/regenerate-candidate`,`regenerated_count++`
- 全局「重新生成」→ 调 `/three-b/diverge`(再次触发 3 算子并行),覆盖原 candidates

**错误状态**:
- 整个 Stage 2 失败 → 大 banner「生成失败,请重试」+ retry 按钮
- 单算子失败(返回空 list)→ 该列顶部 banner「X 算子暂不可用」,其他列正常

### 5.5 S3DeepenStep

布局:左右两栏(`md:grid-cols-[1fr,2fr]`),左侧来源候选,右侧深化操作。

```
┌─────────────────────┬──────────────────────────────────┐
│ 已选候选(2/3)        │ 二次算子深化                       │
├─────────────────────┼──────────────────────────────────┤
│ [打破] 倒叙展开...   │ 算子: [扭曲 ▾] [融合 ▾]          │
│                     │                                   │
│ [融合] 半机械植物... │ 深化结果:                         │
│                     │ ┌─────────────────────────────┐  │
│ [+ 添加更多(可上一步)│ │ 算子: 扭曲                   │  │
│                     │ │ 子维度: 尺度扭曲              │  │
│                     │ │ 倒叙宇宙压缩到一呼之间...    │  │
│                     │ │ [再深化]                     │  │
│                     │ └─────────────────────────────┘  │
│                     │  ┌─────────────────────────────┐  │
│                     │ │ 算子: 扭曲                   │  │
│                     │ │ ...                          │  │
│                     │ └─────────────────────────────┘  │
├─────────────────────┴──────────────────────────────────┤
│ [新颖度评分 + 合成]                                      │
│ 雷达: ...                                              │
│ 综合: 60 B+                                            │
│ 提交按钮(已深化 2/3)                                    │
└────────────────────────────────────────────────────────┘
```

**S3DeepenStep 行为**:
1. 左侧展示 Stage 2 选中候选(不可编辑;要改回 Stage 2)
2. 每个选中候选右侧有「算子 picker」(排除 `source_operator`,例如原为「打破」则只能选「扭曲」或「融合」)
3. 选完算子 → 自动调 `/three-b/deepen`,结果实时显示
4. 可对单候选「再深化」(调 deepen API,`deepen_count++`)
5. 全部深化完后(深度 N == 选中数 N)→ 「提交」按钮启用

**commit**:
- 调 `/three-b/commit` 传入所有 `deepened_ids`
- 后端 LLM 合成 concept + NoveltyEvaluator 评分
- 响应渲染:value_stack editor(沿用 S0E 模式,可选)+ NoveltyRadar + 综合分
- 「提交创意发散」按钮 → `onCommitSuccess` → 通知 WizardContext 标记 step 1 完成

### 5.6 StepIndicator (3 阶段)

```tsx
const STAGES = [
  { key: "1", label: "输入灵感" },
  { key: "2", label: "3B 发散" },
  { key: "3", label: "深化提交" },
];
// 渲染:1. 输入灵感 › 2. 3B 发散 › 3. 深化提交
// 点击规则:已完成的阶段可跳回;未达不可点
```

### 5.7 与现有 wizard / ConceptStep 的兼容

**调用方**:`WorkspaceWizardPanel`(`step === 1` 时渲染 `<CreativeDivergenceStep onCommitSuccess={...} />`)

**契约**:
- `CreativeDivergenceStep` 接收 `projectId: string` + `onCommitSuccess?: () => void`(沿用现有 prop 形状)
- 提交成功后回调 `onCommitSuccess` → WorkspaceWizardPanel 把 step 1 标记 completed
- 写入 `concept_and_dna.json` + `creative_divergence.json`(由后端 commit 端点负责)→ Stage 1 ConceptStep 可读取作为 prefill

**对 ConceptStep 的影响**:
- 现有 ConceptStep 的 prefill 来源 `creative_divergence.json`(source="creative_divergence")— 不动
- 3B commit 端点会写入同样 schema 的 `creative_divergence.json`(兼容)
- 因此 ConceptStep.tsx **零改动**

**WizardSidebar 影响**:
- `WizardSidebar.tsx` 中 `SIDEBAR_ITEMS` 第一项 `id="divergence"` 保持不变
- 移除 2026-09-03 dual step-1 后,第一项就是唯一创意发散入口
- step 1 完成的判定:`completedSteps.includes(1)`(沿用现有逻辑)

### 5.8 关键交互细节

| 场景 | UX |
|---|---|
| Stage 2 加载中(10-30s) | 全屏 spinner + 「3 个算子并行发散中…」文案 |
| Stage 2 部分算子失败 | 该算子列空 + 「暂不可用」banner;其他列正常 |
| Stage 3 选 0 个就点「下一步」 | 按钮 disabled |
| Stage 3 选 3 个,但只深化 2 个 | 「提交」按钮 disabled(提示「还有 1 个未深化」) |
| 用户中途刷新页面 | mount 时 `hydrateFromServer(/three-b/state)` 恢复 |
| Stage 1 输入完成后想换 prompt | 提供「重新输入」按钮(仅在 Stage 2 完成后可见)→ DELETE /state → 回 Stage 1 |
| 阶段切换:2 → 1 | StepIndicator 点击跳回;提示「修改将清空已生成的候选」 |
| 网络中断重连 | 现有 toast 机制(不特殊处理) |

---

## 6. 文件清单

### 6.1 新建

| 文件 | 职责 |
|---|---|
| `backend/creative_os/three_b_engine.py` | ThreeBEngine:`diverge()` / `deepen()` / `commit()` / `_call_operator()` / `_load_prompt()` |
| `backend/creative_os/state_machine_three_b.py` | `three_b_state.json` schema 定义 + `state_atomic_write()` |
| `backend/prompts/creative/three_b_breaking.yaml` | 打破算子 prompt(5 子维度) |
| `backend/prompts/creative/three_b_bending.yaml` | 扭曲算子 prompt(6 子维度) |
| `backend/prompts/creative/three_b_blending.yaml` | 融合算子 prompt(6 子维度) |
| `backend/prompts/creative/three_b_commit.yaml` | Stage 3 提交合成 prompt |
| `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` | 阶段 1:灵感输入 |
| `frontend/src/components/wizard/divergence_v2/S2DivergenceStep.tsx` | 阶段 2:3 列分组候选 |
| `frontend/src/components/wizard/divergence_v2/S3DeepenStep.tsx` | 阶段 3:选候选 + 二次算子 + 提交 |
| `frontend/src/components/wizard/divergence_v2/StepIndicator.tsx` | 3 阶段指示器 |
| `frontend/src/components/wizard/divergence_v2/types.ts` | TypeScript 类型定义 |
| `tests/test_creative_os/test_three_b_engine.py` | ThreeBEngine 单测 |
| `tests/test_api/test_three_b_routes.py` | API 端点单测 |
| `tests/test_creative_os/test_three_b_state.py` | State 写盘原子性 |
| `tests/test_prompts/test_three_b_yaml.py` | 4 个 YAML + Plaza 注册 |
| `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx` | S1 单测 |
| `frontend/src/test/wizard/divergence_v2/S2DivergenceStep.test.tsx` | S2 单测 |
| `frontend/src/test/wizard/divergence_v2/S3DeepenStep.test.tsx` | S3 单测 |
| `frontend/src/test/wizard/divergence_v2/StepIndicator.test.tsx` | StepIndicator 单测 |

### 6.2 修改

| 文件 | 修改 |
|---|---|
| `backend/api/creative_diverge.py` | 添加 `three_b_router`(3 主端点 + 3 辅助端点),单文件追加 |
| `backend/services/prompt_defaults.py` | 注册 4 个新 prompt entry |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | 重写为 3 阶段 orchestrator |
| `frontend/src/api/client.ts` | 新增:`postThreeBDiverge` / `postThreeBDeepen` / `postThreeBCommit` / `getThreeBState` / `deleteThreeBState` / `postThreeBRegenerateCandidate` |

### 6.3 删除(Canvas 双轨集成清理)

| 文件 | 操作 |
|---|---|
| `frontend/src/components/wizard/WizardSidebar.tsx` | 移除 dual step-1(divergence + canvas)OR 语义;`SIDEBAR_ITEMS` 恢复单一条目 |
| `frontend/src/components/wizard/WizardContext.tsx` | 移除 `activeStep1Surface` / `completedStep1Surfaces` / `setActiveStep1Surface` / `markStep1SurfaceCompleted` / `hydrateStep1Surfaces` / `isStep1EffectivelyCompleted` + 对应 actions + sessionStorage 字段 |
| `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` | 移除 `getCanvasV2State` prefill 与 dual render 逻辑 |
| `frontend/src/pages/CreativeCanvasPage.tsx` | 移除 `embedded` / `onCommitSuccess` props(保留独立 canvas 路由) |
| `frontend/src/test/WizardContext.test.tsx` | 删除 7 个新增 surface 相关测试 |
| `frontend/src/test/WizardSidebar.test.tsx` | 移除 dual step-1 测试;恢复单一条目测试 |
| `frontend/src/test/WorkspaceWizardPanel.test.tsx` | 移除 canvas prefill → surface 推导测试 |
| `frontend/src/test/pages/CreativeCanvasPage.test.tsx` | 移除 embedded/onCommitSuccess 测试 |
| `frontend/src/components/wizard/divergence/` | 旧 5 阶段目录可整体删除(S0A/S0B/S0C/S0D/S0E + StepIndicator),仅保留 git 历史 |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.tsx` | 删除 |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.test.tsx` | 删除 |

**保留**:独立 `/project/:id/canvas` 路由与 Canvas 页(`CreativeCanvasPage.tsx` 减 props 后保留)。

---

## 7. 测试策略

### 7.1 后端

| 测试 | 文件 | 关键 case |
|---|---|---|
| ThreeBEngine.diverge 单测 | `tests/test_creative_os/test_three_b_engine.py` | mock LLM client,验证返回的 candidates 结构正确;mock 失败场景;mock 3 个算子并发 |
| ThreeBEngine.deepen 单测 | 同上 | `applied_operator == source_operator` → 422;正常路径;多次 deepen append |
| ThreeBEngine.commit 单测 | 同上 | `deepened_ids` 长度 1-3;缺 ID → 422;正常合成 |
| API endpoints 单测 | `tests/test_api/test_three_b_routes.py` | /diverge /deepen /commit /state /regenerate-candidate /state-DELETE 的 happy path + 422 + 404 |
| 并发 / 限流 | 同上 | `Semaphore(3)` 在 5 个并发请求下不会打爆 LLM |
| Prompt 加载 | `tests/test_prompts/test_three_b_yaml.py` | 4 个新 YAML 文件存在;`prompt_defaults` 注册;3-tier override 解析 |
| State 写盘原子性 | `tests/test_creative_os/test_three_b_state.py` | 模拟中途崩溃;mount 时 state 一致 |

### 7.2 前端

| 测试 | 文件 | 关键 case |
|---|---|---|
| S1InputStep 单测 | `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx` | 输入校验;提交触发 `/three-b/diverge` |
| S2DivergenceStep 单测 | `frontend/src/test/wizard/divergence_v2/S2DivergenceStep.test.tsx` | 3 列渲染;CandidateCard 选择/取消;选中数 0/3 边界;「再生成」单卡 vs 全局;单算子失败 banner |
| S3DeepenStep 单测 | `frontend/src/test/wizard/divergence_v2/S3DeepenStep.test.tsx` | Operator picker 排除 source;deepen 调用;提交按钮 enabled 条件 |
| StepIndicator 单测 | `frontend/src/test/wizard/divergence_v2/StepIndicator.test.tsx` | 3 阶段渲染;jump 规则 |
| CreativeDivergenceStep orchestrator | `frontend/src/test/wizard/CreativeDivergenceStep.test.tsx`(重写) | mount hydrate;状态机转换;`onCommitSuccess` 回调 |
| Cleanup 回归 | 见 §7.3 | dual step-1 测试删除后,旧路径仍工作 |

### 7.3 清理回归测试

需要确认下列测试用例**全部被移除**且不破坏其他测试:

| 来源文件 | 移除用例 |
|---|---|
| `WizardContext.test.tsx` | 7 个新增 surface tests(`setActiveStep1Surface` / `markStep1SurfaceCompleted` / `hydrateStep1Surfaces` / `isStep1EffectivelyCompleted` 等) |
| `WizardSidebar.test.tsx` | dual step-1 OR-semantic 测试;8-item vs 双 surface 渲染分支 |
| `WorkspaceWizardPanel.test.tsx` | canvas prefill → `completedStep1Surfaces` 推导;main area dual render |
| `CreativeCanvasMountPoint.test.tsx` | 全部删除 |
| `CreativeCanvasPage.test.tsx` | embedded + `onCommitSuccess` props 测试 |

**保留**:CreativeCanvasPage 独立访问的现有测试(`/project/:id/canvas` 路由仍工作)。

### 7.4 E2E(手动 smoke + 可选自动化)

| 场景 | 步骤 |
|---|---|
| 全流程 happy path | 进项目 → wizard step 1 → 输入灵感 → 等 3B 并行(10-30s)→ 看到 12 个候选 → 选 2 个 → 各自选二次算子 → 等 deepen(5-10s/个)→ 看雷达 → 提交 → 验证 concept_and_dna.json 存在 + creative_divergence.json 可被 Stage 2 ConceptStep 读取 |
| Prompt Plaza 编辑回归 | 进 /prompt-plaza → 看到 three_b_breaking/bending/blending/commit 4 条 → 编辑其中一个 → 保存 → 重新触发 `/three-b/diverge` → 验证新 prompt 生效 |
| 部分算子失败 | 模拟 LLM 单算子超时 → 该列展示「暂不可用」→ 其他 2 列正常 → 用户仍可选深化 |
| 清理回归 | 旧 5 阶段路径不应再出现在 UI;WizardSidebar 仅显示一个「创意发散」入口;Canvas 页可独立访问但不挂在 wizard 下 |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 3 个 LLM 并发超时(某算子卡 60s+) | 中 | Stage 2 长时间 loading | 每算子加 30s 单算子超时;gather 用 `return_exceptions=True`;前端 30s 后展示「X 算子较慢」 |
| LLM 输出格式不稳定(漏字段 / 多余文字) | 高 | 后端解析失败 | 严格 JSON schema + `_coerce_candidate()` 兜底;regex 抓 JSON 块;前端展示默认值 |
| 提示词编辑破坏结构 | 中 | 后续 diverge 全部失败 | Prompt Plaza 编辑器仅暴露 system/user 两个核心字段,output_format 锁定 |
| 老 creative_divergence.json 项目迁移 | 高 | 老项目看不见 3B 流程 | commit 端点兼容读老字段;前端 mount 时探测 state 文件版本 |
| 3B 流程与现有 canvas path 双源数据冲突 | 低 | 用户困惑 | UI 隔离:Canvas 路由独立,不挂在 wizard 下;任何 `/creative/canvas/*` 路径不写 `three_b_state.json` |
| 并发调用 `/three-b/diverge` 同一项目 | 低 | state 文件 race condition | 写盘走 atomic tmp + replace;后端加 in-memory `asyncio.Lock(project_id)` |
| Stage 3 多次 deepen 数量爆炸 | 低 | state 越来越大 | 单候选 deepen_count 上限 5(前端按钮 disable + 后端 422) |
| MemoryOS / StoryOS 字段对 3B 概念无感 | 中 | 下游 Stage 1 / Stage 4 不消费 3B 信息 | 3B commit 仍写入 concept_and_dna.json 标准字段,下游零改动 |

---

## 9. 验收 checklist

### 9.1 目标 1:5 阶段→3 阶段

- [ ] Wizard 侧栏第 1 项「创意发散」入口进入后,UI 显示 3 个阶段(输入灵感 / 3B 发散 / 深化提交),不是 5 个
- [ ] StepIndicator 仅 3 个 tab,点击规则符合已完成可跳回、未达不可点
- [ ] 原 5 个子组件 `S0AInputStep` / `S0BMutationStep` / `S0CContradictionStep` / `S0DWhatIfStep` / `S0ECommitStep` 不再被引用
- [ ] `divergence/` 旧目录可整体删除(无外部依赖后)

### 9.2 目标 2:3B 算子并行发散

- [ ] Stage 2 后端 `/three-b/diverge` 单次调用触发 3 个 LLM 调用(`asyncio.gather`),各自从对应 prompt 加载
- [ ] 每个算子 prompt 包含各自 5/6 个子维度清单,LLM 自主选 3-5 个
- [ ] 默认每选中子维度产出 1 个候选
- [ ] Stage 2 UI 严格 3 列布局,每列对应一个算子
- [ ] 候选总数 9-15(3 算子 × 3-5 子维度)
- [ ] Stage 3 用户可从候选中选 1-3 个,每个选不同的二次算子
- [ ] 二次算子排除 `source_operator`(前端禁用 + 后端 422)

### 9.3 目标 3:Prompt Plaza 可查看编辑

- [ ] `/prompt-plaza` 页面新增 4 条 entry:`three_b_breaking` / `three_b_bending` / `three_b_blending` / `three_b_commit`
- [ ] 每条 entry 显示 `category=creative`、description 含「3B」关键字
- [ ] 编辑后保存走现有 3-tier override 机制(YAML → Global → Project)
- [ ] 重新触发 `/three-b/diverge` 时读取最新 prompt(验证 override 生效)
- [ ] `three_b_commit.yaml` 暴露给 Plaza 编辑(用户可调 LLM 合成策略)

### 9.4 附加目标:清理 Canvas 集成

- [ ] `WizardSidebar.tsx` 第一项仅显示「创意发散」(无 Canvas 平行入口)
- [ ] `WizardContext.tsx` 移除 surface 相关 state / actions / methods
- [ ] `CreativeCanvasMountPoint.tsx` 文件删除
- [ ] `CreativeCanvasPage.tsx` 移除 `embedded` / `onCommitSuccess` props
- [ ] 独立 `/project/:id/canvas` 路由仍可访问(页面独立工作)
- [ ] 所有 surface 相关测试用例删除

### 9.5 兼容性

- [ ] 现有 `concept_and_dna.json` 下游消费者(Stage 1 ConceptStep、Stage 2 WorldStep 等)零改动
- [ ] 现有 `creative_divergence.json` source 白名单仍接受 `source="creative_divergence"`(3B commit 写入兼容 schema)
- [ ] 现有 `mutation_engine` / `contradiction_engine` / `whatif_engine` 不被 3B 流程调用(解耦验证)

---

## 10. Self-Review

1. **占位符扫描**:无 TBD / TODO / 「后续补充」。
2. **内部一致性**:架构图、数据 schema、端点契约、prompt 结构、组件分解、验收 checklist 全部对齐;3 阶段边界清晰(Stage 1 仅输入,Stage 2 仅并行发散,Stage 3 仅深化+提交)。
3. **范围**:聚焦于 Wizard 侧 5→3 重构 + Canvas 双轨清理,单一实现 plan 可承载(预估 12-16 个任务)。
4. **歧义**:
   - 「3-5 个子维度」已明确:LLM 自主选 + 默认 1 候选/子维度
   - 「1-3 个深化候选」已明确:前端禁用 + 后端 422
   - 「二次算子排除 source」已明确:前端禁用 + 后端 422
   - 「单候选 deepen_count 上限 5」已明确
   - 清理范围已明确:仅清理 Wizard<->Canvas 集成,Canvas 独立路由保留
