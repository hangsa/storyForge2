# 创意发散系统重构 Spec

> 基于 [`/docs/design/创意发散系统PRD_v1.0.docx`](../design/创意发散系统PRD_v1.0.docx) 实现 v1.1 + v1.2 范围重构。
> 范围:统一后端路由 (`/creative/diverge/*`)、补齐缺失端点、修复 `source` 白名单、接入未使用的引擎、前端 Wizard 步骤切换为 5 阶段子步骤。
> 不在范围:v1.3 阶段(Path B stub 删除、301 重定向)。

---

## 1. 背景与目标

### 1.1 当前问题

后端存在两条并行创意发散实现路径:

- **Canvas 路径** (`backend/api/creative_canvas.py`,1676 行):完整 LLM-backed,11 个端点于 `/api/v1/projects/{id}/creative/canvas/*`,业务逻辑丰富
- **Path B Stub** (`backend/api/creative_divergence.py`,130 行):确定性循环 `_generate_variants`,不调用任何 LLM,4 个端点于 `/api/projects/{id}/creative-divergence/*`

前端 `WorkspaceWizardPanel` step 1 (`CreativeDivergenceStep.tsx`) 调用 Path B Stub,用户永远拿不到 Canvas 引擎的真实能力。Path B 注释 `creative_divergence.py:58-61` 自承认: `mutation_engine.mutate_idea` 和 `idea_pool.sample_idea_pool` 不存在。

### 1.2 关键 gap

| 项 | 现状 | 问题 |
|---|---|---|
| Wizard 5 阶段体验 | 调用 130 行 stub | 用户拿不到真实发散能力 |
| `source="canvas"` 写入 | `ALLOWED_CONCEPT_SOURCES = {manual, creative_divergence}` | Canvas 提交的概念 DNA 被 Stage 1 拒绝 |
| ContradictionEngine | `expand()` 定义无 HTTP caller | PRD §3.2 的 5 模板能力未暴露 |
| GenreFusionEngine | `calculate_distance()` 定义无 caller | PRD §3.4 类型融合未启用 |
| IdeaPool | CRUD only,无 importer | 生成的 variants 不沉淀 |
| NoveltyEvaluator market_saturation | `tags=[]` 退化为 50.0 | 30% 权重失效,总分不可信 |
| canvas_state schema | v2,缺 `core_contradiction`/`novelty_scores`/`session_metadata` | 不符 PRD §4.2 |

### 1.3 重构目标

| 阶段 | 目标 |
|---|---|
| **v1.1** | 后端统一路由 `/creative/diverge/*`,补齐 `/contradict`、`/regenerate`、`/fuse`、`/novelty`,更新 `source` 白名单,接入 GenreFusionEngine + IdeaPool + 修复 market_saturation,`canvas_state.json` 升级到 v3 |
| **v1.2** | 前端 `CreativeDivergenceStep.tsx` 改写为 5 阶段子步骤,调用新端点;`WorkspaceWizardPanel` 移除 Path B prefill 引用 |

### 1.4 不在范围

- v1.3 阶段:Path B stub 删除、301 重定向、保留 Path B 端点至 v1.3
- 跨项目 IdeaPool 查询 UI
- 24h 草稿自动归档(v1.1+ 增强)
- Canvas 页面 UI 重做(独立画布模式)

---

## 2. 顶层架构

```
                    ┌─────────────────────────────────┐
                    │  WorkspaceWizardPanel (step 1)  │
                    │  CreativeDivergenceStep         │
                    │  ├ S0AInputStep                 │
                    │  ├ S0BMutationStep              │
                    │  ├ S0CContradictionStep         │
                    │  ├ S0DWhatIfStep                │
                    │  └ S0ECommitStep                │
                    │                                  │
                    │  ────── v1.2 ──────              │
                    │                                  │
                    │  /project/:id/canvas (Canvas 页) │
                    │  CanvasToolbar + WhatIfTree      │
                    │  + NoveltyRadar + NodeDetail     │
                    └──────────┬──────────────────────┘
                               │ HTTP
                               ▼
        ┌──────────────────────────────────────────┐
        │  /api/v1/projects/{id}/creative/diverge/* │
        │  ┌─────┬─────────┬──────────┬──────────┐  │
        │  │init │ mutate │ contradict│ whatif   │  │
        │  │expand│ select │ evaluate │ commit   │  │
        │  │state │ fuse  │regenerate│ novelty  │  │
        │  └─────┴─────────┴──────────┴──────────┘  │
        │                                          │
        │  路由层: creative_diverge.py              │
        │  (原 creative_canvas.py 重命名)           │
        │                                          │
        │  引擎层: MutationEngine, Contradiction    │
        │         Engine, WhatIfEngine,             │
        │         GenreFusionEngine,                │
        │         NoveltyEvaluator, IdeaPool        │
        │                                          │
        │  Agent: PlannerAgent                     │
        │         .generate_concept_from_canvas     │
        │         (canvas_to_concept.yaml)          │
        └──────────┬───────────────────────────────┘
                               │ 写
                               ▼
        ┌─────────────────────────┐
        │ canvas_state.json v3    │
        │ concept_and_dna.json    │
        │ creative_divergence.json│  (compat dual-write)
        └─────────────────────────┘
```

### 2.1 设计原则

1. **单一入口**:所有创意发散 HTTP 调用走 `/creative/diverge/*`,Path B 路由仅保留为弃用别名至 v1.3
2. **同源数据**:Wizard 5 阶段子步骤与独立 Canvas 页读写同一 `canvas_state.json`,可切换无丢失
3. **画布即真相**:`canvas_state.json` schema v3 是产品状态唯一来源,前端不维护第二份 memory
4. **降级兼容**:旧 `source="creative_divergence"` 项目继续有效,Stage 1 守卫不破坏现有数据
5. **引擎职责清晰**:5 个引擎只负责各自域的计算(变异/矛盾/What-If/融合/评分),路由层负责编排与持久化

---

## 3. 后端 API 端点

### 3.1 端点总表

所有路径前缀:`/api/v1/projects/{project_id}/creative/diverge`

| Method | Path | 来源 | v1.1 改动 |
|---|---|---|---|
| POST | `/init` | canvas `/init` | 重命名 |
| POST | `/mutate` | canvas `/apply-mutation` | 重命名,语义对齐 |
| POST | `/mutate/{node_id}/regenerate` | canvas `/apply-mutation` | 拆分新增 |
| POST | `/contradict` | **新增** | `ContradictionEngine.expand` + 5 模板推荐 |
| PUT | `/contradict` | **新增** | 用户确认/自定义矛盾写回 |
| POST | `/whatif/expand` | canvas `/expand` | 重命名,加 `forbidden_directions` 注入 |
| PUT | `/whatif/select` | canvas `/choose-branch` + `/select` | 合并 |
| GET | `/novelty` | canvas `/evaluate`(单节点 → 整树) | 升级为列表级,返回 4 维 + composite |
| POST | `/commit` | canvas `/commit` | 补 `style_template` 字段 + 4 层 `value_stack` + 响应格式调整 |
| GET | `/state` | canvas GET `/state` | 重命名 |
| DELETE | `/state` | canvas DELETE `/state` | 重命名 |
| POST | `/fuse` | **新增** | `GenreFusionEngine` + `MutationEngine.fuse` 联合调用 |

### 3.2 Path B 兼容端点(v1.1 起标 deprecated)

| Method | Path | v1.1 行为 |
|---|---|---|
| GET | `/api/projects/{id}/creative-divergence` | 标 `Deprecation: true` + `Sunset: 2026-12-31` + `Link: .../diverge/state; rel="successor-version"`,返回旧数据 |
| POST | `/api/projects/{id}/creative-divergence/generate` | 同上 |
| POST | `/api/projects/{id}/creative-divergence/select` | 同上 |
| GET | `/api/projects/{id}/creative-divergence/prefill-check` | 同上 |

v1.3 端点返回 301 重定向(不在 v1.1+v1.2 范围)。

### 3.3 `/commit` 关键端点契约

**请求体**:

```json
{
  "session_id": "uuid-string",
  "confirmed_path_ids": ["node-root", "node-3", "node-7"],
  "user_notes": "可选,LLM 提炼提示",
  "value_stack_override": [
    {"value_a": "...", "value_b": "...", "level": "personal"},
    {"value_a": "...", "value_b": "...", "level": "social"},
    {"value_a": "...", "value_b": "...", "level": "philosophical"},
    {"value_a": "...", "value_b": "...", "level": "existential"}
  ]
}
```

**响应 200**:

```json
{
  "concept_preview": {
    "title": "...",
    "genre": "...",
    "premise": "...",
    "tone": "...",
    "theme": "...",
    "target_audience": "..."
  },
  "story_dna_preview": {
    "core_contradiction": {"statement": "...", "side_a": "...", "side_b": "..."},
    "value_stack": [4 items],
    "style_template": "..."
  },
  "novelty_summary": {
    "market_saturation": 0.7,
    "trope_similarity": 0.6,
    "contradiction_depth": 0.8,
    "discussion_potential": 0.5,
    "composite": 0.65
  },
  "next_step_url": "/project/{id}/wizard?step=2",
  "warnings": ["novelty_below_threshold:composite<0.4 仅警告,不阻止"]
}
```

**错误码**:

| Code | HTTP | 触发条件 |
|---|---|---|
| `INTENT_TOO_SHORT` | 400 | `raw_intent.prompt.length < 10` |
| `GENRE_MISSING` | 400 | 未选 `genre_primary` |
| `PATH_NOT_SELECTED` | 422 | `selected_path` 为空 |
| `CONCEPT_SCHEMA_ERROR` | 500 | LLM 输出缺字段,内部已重试 2 次 |
| `LLM_BACKEND_UNAVAILABLE` | 503 | LLM 调用失败或降级 |
| `CANVAS_NOT_INITIALIZED` | 400 | canvas_state 不存在 |
| `RACE_CONDITION` | 409 | ETag 不匹配 |
| `VALIDATION_FAILED` | 422 | pydantic 校验失败 |

> **D-2 影响**:`tension_score < 40` 和 `novelty composite < 0.4` 不阻止提交,改在响应 `warnings` 字段中返回非致命警告。前端在 S0E 面板展示红色警告 banner 但不禁用"提交"按钮。

### 3.4 `/novelty` 列表级评分

**响应 200**:

```json
{
  "market_saturation": 0.7,
  "trope_similarity": 0.6,
  "contradiction_depth": 0.8,
  "discussion_potential": 0.5,
  "composite": 0.65,
  "computed_at": "2026-08-30T12:00:00Z",
  "trope_extraction_status": "completed"
}
```

`trope_extraction_status`: `"pending" | "completed" | "failed"`。`pending` 时 `market_saturation` 返回 50.0 兜底,前端轮询 1-2 秒可见 `completed`。

### 3.5 `/contradict` 关键端点

**`POST /contradict` 请求**:

```json
{
  "variant_id": "variant-3",
  "variant_content": "..."
}
```

**响应 200**:

```json
{
  "candidates": [
    {
      "template_type": "ABILITY_VS_LIMIT",
      "preview_statement": "...",
      "side_a": "...",
      "side_b": "...",
      "tension_score": 78
    },
    ...
  ]
}
```

候选按 `tension_score` 降序,最多 5 个。

**`PUT /contradict` 请求**:

```json
{
  "template_type": "ABILITY_VS_LIMIT",
  "statement": "...",
  "side_a": "...",
  "side_b": "...",
  "is_custom": false
}
```

`tension_score` 缺失时后端调 `ContradictionEngine.score_depth()` 自动计算。

---

## 4. 数据模型

### 4.1 `canvas_state.json` schema v3

```json
{
  "schema_version": 3,
  "session_id": "uuid",
  "_etag": "16-char-hex",
  "raw_intent": {
    "prompt": "...",
    "genre_primary": "修仙",
    "genre_secondary": null,
    "target_reader": "...",
    "reference_works": [],
    "forbidden_directions": [],
    "quick_mode": false,
    "trope_tags": ["..."]
  },
  "root_node_id": "node-root",
  "nodes": {
    "node-root": {
      "id": "node-root",
      "depth": 0,
      "parent_id": null,
      "content": "...",
      "trope_tags": ["..."],
      "saturation_warning": false,
      "novelty_score": null,
      "mutation_context": null,
      "children_ids": ["node-1", "node-2", "node-3"],
      "is_expanded": true,
      "branch_status": "active"
    }
  },
  "edges": [
    {"from": "node-root", "to": "node-1", "type": "mutation:fusion"}
  ],
  "selected_path": ["node-root", "node-3", "node-7"],
  "branch_choices": {"node-root": "node-3"},
  "core_contradiction": {
    "template_type": "ABILITY_VS_LIMIT",
    "statement": "...",
    "side_a": "...",
    "side_b": "...",
    "tension_score": 75,
    "is_custom": false,
    "confirmed_at": "2026-08-30T12:00:00Z"
  },
  "novelty_scores": {
    "market_saturation": 0.7,
    "trope_similarity": 0.6,
    "contradiction_depth": 0.8,
    "discussion_potential": 0.5,
    "composite": 0.65,
    "computed_at": "2026-08-30T12:00:00Z"
  },
  "idea_variants": [
    {
      "id": "variant-1",
      "title": "...",
      "premise_one_line": "...",
      "mutation_type": "inversion",
      "mutation_logic": "...",
      "estimated_novelty": 0.7,
      "trope_tags": ["..."],
      "regenerated_count": 0
    }
  ],
  "session_metadata": {
    "created_at": "2026-08-30T11:00:00Z",
    "last_modified_at": "2026-08-30T12:00:00Z",
    "elapsed_seconds": 3600,
    "operation_count": 12,
    "ab_test_bucket": "control"
  },
  "created_at": "...",
  "updated_at": "...",
  "committed_at": null,
  "committed_concept_ref": null
}
```

### 4.2 v2 → v3 自动迁移

`_read_canvas` 函数入口检测 `schema_version`,缺失字段补默认值:

| v2 字段 | v3 默认值 |
|---|---|
| `core_contradiction` | `null`(用户需重做 S0-C) |
| `novelty_scores` | `null`(前端触发 `/novelty` 计算) |
| `idea_variants` | 从 `nodes` 中 `mutation_context.mut` 标记提取 |
| `session_metadata` | 基于 `created_at` 推断 |
| `raw_intent` | `null`(用户需重做 S0-A) |
| `schema_version` | 2 → 3 |

### 4.3 `concept_and_dna.json` 扩展

`PlannerAgent.generate_concept_from_canvas` 模板 (`backend/prompts/canvas_to_concept.yaml`) 需补字段:

```yaml
user_prompt_template: |
  ...(原有输入)...

  请在 story_dna 中额外输出 style_template 字段,基于类型与变异类型推荐写作风格参照(如:冷硬、克制、意识流等)。
  value_stack 必须为恰好 4 层(从具体到抽象:personal → social → philosophical → existential)。

  {{"concept": ..., "story_dna": {{"core_contradiction": ..., "value_stack": [...4 items], "style_template": "..."}}}}
```

原模板约束"value_stack 至少 3 组"升级为"恰好 4 层"。

### 4.4 `creative_divergence.json` 双写

`/commit` 写入 `concept_and_dna.json` (`source="canvas"`) 后,**同步**写入 `creative_divergence.json` 的 `prompt` 字段供 Stage 1 守卫兼容读取:

```json
{
  "prompt": "原始 raw_intent.prompt 前 100 字",
  "variants": [],
  "selected_id": null,
  "selected_at": "2026-08-30T12:00:00Z",
  "source": "canvas"
}
```

`variants[]` 字段空数组(Path B 数据格式),不强制塞入 canvas 路径的 idea_variants。Stage 1 守卫只读 `prompt` 字段,不受影响。

---

## 5. 引擎层接入

### 5.1 MutationEngine 接入 `fuse()`

`fuse()` 已定义在 `backend/creative_os/mutation_engine.py:81`,签名 `fuse(trope_a: Trope, trope_b: Trope) -> MutationResult`。v1.1 接 `/fuse` 端点:

```python
@router.post("/fuse")
async def fuse_genres(project_id: str, request: FuseRequest):
    fusion = genre_fusion_engine.calculate_distance(
        request.genre_primary, request.genre_secondary
    )
    # MutationResult → idea_variant 适配层
    trope_a = trope_pool.get_by_genre(request.genre_primary)
    trope_b = trope_pool.get_by_genre(request.genre_secondary)
    mutation_result = await mutation_engine.fuse(trope_a, trope_b)
    variant = _mutation_to_idea_variant(mutation_result)
    # 落库
    await idea_pool_importer.add_batch([variant], source_stage="fuse")
    return {
        "variants": [variant],
        "fusion_distance": fusion,
        "risk_level": fusion["distance"] >= 61 and "high" or
                      (fusion["distance"] >= 31 and "medium" or "low")
    }
```

`MutationResult` 字段(`core_premise`/`core_conflict`/`novelty_hook`)通过适配层映射到 `idea_variant` 的 `premise_one_line`/`mutation_logic`/`estimated_novelty`。

### 5.2 ContradictionEngine 新增 HTTP 接入

`ContradictionEngine.expand(template: ContradictionTemplate, context: str) -> ContradictionExpansion` 签名:接收模板枚举 + 上下文(变体内容/原始 prompt),调用 LLM 展开矛盾。陈述。

```python
@router.post("/contradict")
async def list_contradictions(project_id: str, request: ContradictRequest):
    # 遍历 5 个模板,各调用一次 expand(),汇总候选
    candidates = []
    for template in ContradictionTemplate:
        expansion = await contradiction_engine.expand(
            template, context=request.variant_content
        )
        candidates.append({
            "template_type": template.value,
            "preview_statement": expansion.statement,
            "side_a": expansion.side_a,
            "side_b": expansion.side_b,
            "tension_score": contradiction_engine.score_depth(expansion.statement),
        })
    # 按 tension_score 降序,top 5
    candidates.sort(key=lambda x: x["tension_score"], reverse=True)
    return {"candidates": candidates[:5]}

@router.put("/contradict")
async def confirm_contradiction(project_id: str, request: ConfirmContradictRequest):
    canvas = _read_canvas(project_id)
    canvas["core_contradiction"] = {
        "template_type": request.template_type,
        "statement": request.statement,
        "side_a": request.side_a,
        "side_b": request.side_b,
        "tension_score": request.tension_score or contradiction_engine.score_depth(request.statement),
        "is_custom": request.is_custom,
        "confirmed_at": datetime.utcnow().isoformat()
    }
    _write_canvas(project_id, canvas)
    return {"core_contradiction": canvas["core_contradiction"]}
```

### 5.3 WhatIfEngine 防重复强化

`expand_node` 已有 prompt 注入父节点内容,新增 **禁用方向列表** 参数:

```python
class ExpandRequest(BaseModel):
    node_id: str
    forbidden_directions: list[str] = []  # 已有枝干的简短描述
    depth_target: int = 1
```

### 5.4 GenreFusionEngine BFS 距离矩阵

引擎定义在 `backend/creative_os/genre_fusion_engine.py`,`calculate_distance()` 返回 0-100。

v1.1 接入 `/fuse` 端点,`/mutate` 在用户选 fusion 变异时也复用此引擎判断风险:

```python
# /mutate 内部:
if request.mutation_type == "fusion":
    fusion = genre_fusion_engine.calculate_distance(
        request.genre_primary, request.genre_secondary
    )
    # 距离 ≥ 31 才调用 LLM 融合,近亲跳过
    if fusion["distance"] < 31:
        return {"variants": [], "warning": "GENRES_TOO_CLOSE"}
    trope_a = trope_pool.get_by_genre(request.genre_primary)
    trope_b = trope_pool.get_by_genre(request.genre_secondary)
    mutation_result = await mutation_engine.fuse(trope_a, trope_b)
    variant = _mutation_to_idea_variant(mutation_result)
```

### 5.5 NoveltyEvaluator market_saturation 修复

PRD §3.5 表中标注 `⚠ tags=[] 退化为 50.0`。修复方案:

1. 在 `raw_intent` 写入后,**异步**触发 LLM Trope 提取(后端不阻塞,前端看到 `trope_extraction_status: "pending"`)
2. 提取完成后写回 `raw_intent.trope_tags`,`_market_saturation` 不再退化
3. LLM 调用 Tier 3 (Haiku),prompt 从 `config/prompts/trope_extraction.yaml`(新建)

```python
# backend/creative_os/novelty_evaluator.py:
async def fill_trope_tags(raw_intent: dict, llm_client):
    """Async-fire-and-forget LLM call."""
    prompt = build_trope_extraction_prompt(raw_intent["prompt"])
    tags = await llm_client.complete(prompt, tier=3)
    raw_intent["trope_tags"] = tags
    save_canvas()
```

### 5.6 IdeaPool 接入

`backend/creative_os/idea_pool.py` 当前是 per-project CRUD(`<project>/creative_os/idea_pool.json`),`add(idea: Idea)` 是同步方法。v1.1 新增 `importer` 模块:

```python
# backend/creative_os/idea_pool_importer.py 新文件
from backend.models.creative_os import Idea, IdeaCategory

class IdeaPoolImporter:
    def __init__(self, pool: IdeaPool):
        self.pool = pool

    def add_batch(self, variants: list[dict], source_stage: str):
        """variants → Idea 适配层。"""
        for v in variants:
            idea = Idea(
                id=v["id"],
                content=v.get("premise_one_line", v.get("title", "")),
                # IdeaCategory 现有 5 个值,选用 SETTING(变体本质是设定层面的)
                category=IdeaCategory.SETTING,
                source_stage=source_stage,  # "fuse" / "mutate:inversion" / 等
                source_context=json.dumps(v),
                related_elements=v.get("trope_tags", []),
                confidence=v.get("estimated_novelty", 0.0),
            )
            self.pool.add(idea)
```

**架构调整**:IdeaPool 是 per-project,无跨项目查询。跨项目 IdeaPool 全局池不在 v1.1 范围(留 v1.3+);v1.1 仅在当前项目内做 importer 落库,跨项目复用不在范围。

---

## 6. Source 白名单更新

### 6.1 当前实现

`backend/api/stage1_concept.py:124`:

```python
ALLOWED_CONCEPT_SOURCES = {"manual", "creative_divergence"}
```

### 6.2 v1.1 改动

```python
ALLOWED_CONCEPT_SOURCES = {"manual", "creative_divergence", "canvas", "canvas_edited"}
```

### 6.3 Stage 1 PUT `/concept` 端点行为

```python
# stage1_concept.py update_concept():
if payload.source == "canvas":
    # 首次写入升级为 edited
    payload.source = "canvas_edited"
elif payload.source == "canvas_edited":
    pass  # 保留
elif payload.source in ALLOWED_CONCEPT_SOURCES:
    pass  # manual/creative_divergence 保持
else:
    raise HTTPException(400, "INVALID_SOURCE")
```

对齐 PRD §6.2:`source="canvas_edited"` 不再被自动降级为 `"manual"`。

---

## 7. 前端 5 阶段 Wizard 步骤(v1.2)

### 7.1 组件树

```
WorkspaceWizardPanel (step=1)
└── CreativeDivergenceStep (重写)
    ├── StepIndicator (顶部:S0-A › S0-B › S0-C › S0-D › S0-E)
    ├── <当前阶段组件>
    │   ├── S0AInputStep — 大文本框 + 类型选择器 + 高级选项折叠
    │   ├── S0BMutationStep — 6-8 变体卡片 + 多选 + 再生成
    │   ├── S0CContradictionStep — 5 模板卡片 + 张力仪表盘
    │   ├── S0DWhatIfStep — 树状可视化 + 路径高亮 + 快照对比
    │   └── S0ECommitStep — 雷达图 + 综合分 + 价值栈手改
    ├── QuickModeToggle — 顶部开关,开启时跳过 S0-D
    └── ContinueBanner — "已恢复到上次离开的 S0-X 阶段"
```

### 7.2 状态机

```typescript
type SubStage = "A" | "B" | "C" | "D" | "E";
interface CreativeDivergenceState {
  subStage: SubStage;
  sessionId: string | null;        // POST /init 后写入
  rawIntent: RawIntent | null;     // S0-A 提交后
  variants: IdeaVariant[];          // S0-B
  contradiction: CoreContradiction | null;  // S0-C
  whatIfTree: WhatIfTree | null;    // S0-D
  noveltyScores: NoveltyScores | null;  // S0-E
}
```

跳转逻辑:
- 任意阶段完成后:自动推进下一阶段
- 用户点击 StepIndicator 可前后跳(已确认阶段可回看改)
- `quick_mode=true` 时:S0-C → S0-E 跳过 S0-D

### 7.3 与现有组件复用

`frontend/src/components/creative-canvas/` 已有的 8 个组件可复用:

| 现有组件 | 复用至 |
|---|---|
| `CanvasNode` | S0D 树节点 |
| `WhatIfTree` | S0D 主容器 |
| `MutationSuggestion` | S0B 变体卡片 |
| `NoveltyRadar` | S0E 雷达图 |
| `NodeDetailPanel` | S0D 节点详情侧栏 |
| `ResetConfirmDialog` | 删除草稿前确认 |

需要新建:`StepIndicator`、`S0AInputStep`、`S0CContradictionStep`、`S0ECommitStep`(价值栈手改表单)。

### 7.4 API 客户端层改动

`frontend/src/api/client.ts` 新增方法:

```typescript
postDivergeInit(projectId, intent): Promise<{session_id: string}>
postDivergeMutate(projectId, sessionId, op, forbidden): Promise<{variants: IdeaVariant[]}>
postDivergeMutateRegenerate(projectId, variantId): Promise<{variant: IdeaVariant}>
postDivergeContradict(projectId, variantId, variantContent): Promise<{candidates: ContradictionCandidate[]}>
putDivergeContradict(projectId, body: ConfirmContradictRequest): Promise<{core_contradiction: CoreContradiction}>
postDivergeWhatIfExpand(projectId, nodeId, depthTarget, forbidden): Promise<{children: WhatIfNode[]}>
putDivergeWhatIfSelect(projectId, pathIds): Promise<{selected_path: string[]}>
getDivergeNovelty(projectId): Promise<NoveltyScores>
postDivergeCommit(projectId, body: CommitRequest): Promise<CommitResponse>
getDivergeState(projectId): Promise<CanvasStateV3>
deleteDivergeState(projectId): Promise<void>
postDivergeFuse(projectId, body: FuseRequest): Promise<FuseResponse>
```

v1.2 完成时移除:
- `listCreativeDivergenceVariants`
- `generateCreativeDivergenceVariants`
- `selectCreativeDivergenceVariant`
- `getCreativeDivergencePrefill`

### 7.5 与独立 Canvas 页的关系

- Wizard 5 阶段子步骤与独立 Canvas 页 **读写同一 `canvas_state.json`**,通过 `/state` API
- 两者可切换:用户在 Canvas 页面某阶段切到 Wizard,Wizard 子步骤读取已有节点;反之亦然
- 切换不丢失已选路径,`subStage` 在 Canvas 页等价于当前 `selected_path` 末端深度

### 7.6 WizardContext 扩展

`frontend/src/components/wizard/WizardContext.tsx` 扩展:
- 新增 `creativeDivergenceSubStage: SubStage` 字段
- `jumpToStep(1)` 时不直接跳,默认 `jumpToCreativeDivergence("E")`(跳到用户上次停留阶段)
- `regenerateHandler` 在 step 1 阶段可触发整个发散重新生成(需用户二次确认)

---

## 8. 错误处理

### 8.1 错误码完整表

| 错误码 | HTTP | 触发点 | 用户提示 | 后端动作 |
|---|---|---|---|---|
| `INTENT_TOO_SHORT` | 400 | `/init` | "请至少描述 10 个字的创意想法" | 校验 `prompt.length` |
| `GENRE_MISSING` | 400 | `/init` | "请选择至少一个主类型" | 校验 `genre_primary` |
| `PATH_NOT_SELECTED` | 422 | `/commit` | "请在 What-If 树中选择至少一条叙事路径" | 校验 `selected_path` 非空 |
| `CONTRADICTION_TOO_WEAK` | 422 | `/commit` | "核心矛盾强度过低" | `tension_score < 40` — **实际改为 warning,不返回此码** |
| `CONCEPT_SCHEMA_ERROR` | 500 | `/commit` | "生成失败,请重试" | LLM 缺字段,自动重试 2 次 |
| `LLM_BACKEND_UNAVAILABLE` | 503 | 多个端点 | "AI 服务暂时不可用" | LLM 失败或降级 |
| `CANVAS_NOT_INITIALIZED` | 400 | 写端点 | "画布尚未初始化" | canvas_state 不存在 |
| `INVALID_NODE_ID` | 400 | `/whatif/expand` | "节点 ID 不存在" | 校验 node_id |
| `RACE_CONDITION` | 409 | 所有写端点 | "你的草稿已被其他设备更新" | ETag 不匹配 |
| `VALIDATION_FAILED` | 422 | 通用 | 各端点具体 message | pydantic 校验失败 |

### 8.2 重试策略

- **LLM 输出 schema 错**(`/commit`):自动重试 2 次,间隔 5s;仍失败返回 500
- **LLM 后端不可用**:不重试,直接返回 503
- **`/mutate` `/contradict` 单卡片失败**:仅该卡片失败,其他卡片正常返回,前端局部红错
- **`/init` 失败**:不重试,前端展示整页错误

### 8.3 断点续作

- `canvas_state.json` 每次写入更新 `session_metadata.last_modified_at`、`operation_count`
- `GET /state` 返回完整状态(包含当前 `subStage` 推断)
- 用户进入 `/project/:id/wizard?step=1` 时,前端拉 `/state`,若有未提交草稿展示 `ContinueBanner`
- 24h 后草稿自动标记 `archived=true`(待实现,留 v1.1+ 增强)

### 8.4 并发写入保护(乐观锁)

- `canvas_state.json` 顶层加 `_etag: string`(每次写更新)
- 所有 PUT/POST/DELETE 写端点接收请求头 `If-Match: <etag>`
- 不匹配返回 409 `RACE_CONDITION`

```python
# _read_canvas 入口:
import hashlib
canvas["_etag"] = hashlib.md5(
    json.dumps(canvas, sort_keys=True).encode()
).hexdigest()[:16]
```

---

## 9. 迁移与兼容

### 9.1 Schema v2 → v3 自动升级

`_read_canvas` 函数入口检测 `schema_version`,缺失字段补默认值(详见 §4.2)。

### 9.2 Path B 双写

`/commit` 写入 `concept_and_dna.json` 后,**同步**写入 `creative_divergence.json`(仅 `prompt` 字段,供 Stage 1 守卫兼容)。

### 9.3 Path B 端点 Deprecation

v1.1 起 Path B 4 个端点响应头加:

```
Deprecation: true
Sunset: 2026-12-31
Link: </api/v1/projects/{id}/creative/diverge/state>; rel="successor-version"
```

v1.3 端点返回 301 重定向(不在 v1.1+v1.2 范围)。

### 9.4 历史数据迁移

- `source="creative_divergence"` 旧概念:Stage 1 守卫继续接受,无需迁移
- `source="canvas"` 旧概念:补写 `creative_divergence.json`(迁移脚本 `scripts/backfill_creative_divergence.py`,v1.1 上线时跑一次)
- `canvas_state.json` schema v1/v2:v1.1 读路径自动升级

---

## 10. 测试策略

### 10.1 后端单元测试

- `test_creative_diverge_routes.py`:12 个端点的 happy path + 错误码
- `test_contradiction_engine_http.py`:`/contradict` 返回 5 模板排序
- `test_genre_fusion_engine_routes.py`:`/fuse` 距离计算与变体生成
- `test_idea_pool_importer.py`:全局池/项目池两层
- `test_novelty_market_saturation_fix.py`:`tags=[]` 退化路径仍返回 50,但 async 任务填上后下次调用用真实分数
- `test_source_whitelist_update.py`:`canvas`、`canvas_edited` 接受,其他拒绝
- `test_canvas_state_v2_to_v3_migration.py`:旧 v2 文件读路径自动升级
- `test_etag_optimistic_lock.py`:并发写,一个 200 一个 409
- `test_commit_dual_write.py`:`/commit` 后 `concept_and_dna.json` + `creative_divergence.json` 都更新
- `test_path_b_deprecation_headers.py`:Path B 端点响应头含 Deprecation/Sunset/Link

### 10.2 后端集成测试

- `test_e2e_diverge_flow.py`:init → mutate → contradict → whatif → novelty → commit 完整链路
- `test_e2e_dual_write.py`:`/commit` 后两个文件都更新
- `test_e2e_concurrent_writes.py`:两个客户端同时 `/commit`,一个 200 一个 409
- `test_e2e_quick_mode.py`:`quick_mode=true` 跳过 whatif,`/commit` 仍成功
- `test_e2e_v2_to_v3_migration.py`:旧项目 v2 文件升级,继续可用

### 10.3 前端组件测试

- `CreativeDivergenceStep.test.tsx`:5 阶段跳转、quick mode 跳过 D、断点续作 banner
- `S0AInputStep.test.tsx`:字数校验、类型必填
- `S0BMutationStep.test.tsx`:多选上限 3、张力仪表盘颜色
- `S0CContradictionStep.test.tsx`:5 模板候选、自定义入口
- `S0DWhatIfStep.test.tsx`:树展开/折叠、路径高亮
- `S0ECommitStep.test.tsx`:雷达图渲染、价值栈手改、警告 banner
- `WizardContext.test.tsx`:subStage 跳转、regenerate handler

### 10.4 前端 E2E

- 完整 5 阶段从输入到提交
- quick mode 跳 D 路径
- Wizard ↔ Canvas 切换无丢失
- ETag 冲突展示 409 错误

### 10.5 手动测试场景(v1.1 上线前)

- 旧 Path B 项目:Stage 1 守卫仍可读,Stage 1 编辑不破坏
- LLM 降级场景:关掉 LLM 凭据,看错误码是否准确(503 vs 500)
- 并发场景:两个浏览器同项目同时间 commit
- 草稿过期:24h 后重新进入(不在 v1.1 范围,留 placeholder)

---

## 11. 验收标准

对齐 PRD §1.2 OKR:

| OKR | 验收方式 |
|---|---|
| 80% 用户 15 分钟完成 | 手动邀请 5-10 人测试,记录完成时间分布 |
| concept_and_dna 字段齐全 | E2E 测试断言所有 concept + story_dna + style_template + value_stack 4 层 |
| 新颖度评分误差 < 20% | 收集 20 个 seed,人工评分 vs 自动评分,计算 Pearson 相关系数 |

---

## 12. 实施顺序建议

**v1.1 阶段**(后端):

1. 重命名 `creative_canvas.py` → `creative_diverge.py`,路由前缀改为 `/creative/diverge`
2. 新增 `/contradict`、`/mutate/{id}/regenerate`、`/fuse`、`/novelty` 4 个端点
3. 更新 `canvas_state.json` schema v3 + 迁移逻辑
4. 修改 `canvas_to_concept.yaml` 模板输出 `style_template` + 4 层 value_stack
5. 更新 `ALLOWED_CONCEPT_SOURCES` + Stage 1 PUT 行为
6. 接入 `GenreFusionEngine`、`IdeaPool.importer`
7. 修复 `NoveltyEvaluator.market_saturation`(新建 `trope_extraction.yaml` prompt)
8. `/commit` 响应格式调整 + `creative_divergence.json` 双写
9. ETag 乐观锁 + 错误码体系
10. Path B 端点 Deprecation headers
11. 跑迁移脚本 `scripts/backfill_creative_divergence.py`
12. 单元测试 + 集成测试 + 手动验收

**v1.2 阶段**(前端):

1. 新增 `StepIndicator`、`S0AInputStep`、`S0CContradictionStep`、`S0ECommitStep` 4 个组件
2. 重写 `CreativeDivergenceStep.tsx`,5 阶段子步骤 + quick mode toggle + continue banner
3. `api/client.ts` 新增 12 个方法,移除 4 个 Path B 方法
4. `WizardContext.tsx` 扩展 `creativeDivergenceSubStage` + regenerate handler
5. 复用 `creative-canvas/` 6 个组件至对应阶段
6. 单元测试 + E2E 测试 + 手动验收

---

## 13. 后续(不在 v1.1+v1.2 范围)

- v1.3:删除 Path B 端点、301 重定向、`_generate_variants` stub
- 跨项目 IdeaPool 查询 UI
- 24h 草稿自动归档
- Canvas 页面 UI 重做(独立画布模式完整功能)