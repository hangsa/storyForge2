# 创意画布（Creative Canvas）模块综述

---

## 1. 用户需求与产品定位

创意画布要回答的核心产品问题是：**"用户只有一个模糊的灵感点子，如何把它收拢成一个有冲突、有路径、有新颖度评分的创作前提？"**。

它处在整条流水线的**最上游**：

```
灵感 → 创意画布（Creative Canvas）→ 概念确认（Stage 1）→ 世界观（Stage 2）→ 角色（Stage 3）→ 大纲（Stage 3 outline）→ 写作工作台（Workspace）
```

**核心用户价值**：

| 痛点 | 解法 |
|---|---|
| 只有一个 premise 不知道怎么往下想 | 3-op mutation 链自动生成 6 个变体 |
| 想玩类型混搭（修仙+悬疑、星际+法庭） | GenreFusionEngine 按 BFS 距离给融合变体 + 风险等级 |
| 创意没冲突没张力 | ContradictionEngine 5 模板（ABILITY_VS_LIMIT 等）出候选 |
| 单线故事太单薄 | WhatIfEngine 树状展开（depth=3, breadth=4），可选路径 |
| 不知道够不够新 | NoveltyEvaluator 四维评分（market_saturation 30% + trope_similarity 25% + contradiction_depth 25% + discussion_potential 20%） |
| 中途离开怎么办 | `canvas_state.json` 自动持久化，掉线/刷新可续 |

---

## 2. 入口与页面布局

### 路由
`/project/:projectId/stage0/canvas` —— 嵌在 Stage 0 路由分组下，与 `/stage0`、`/stage0/concept`、`/stage0/characters` 等同级。用户在 Stage 0 顶部 Tab 切换进入。

### 页面布局

```
┌─────────────────────────────────────────────────────┐
│ 顶部：stage0Layout（含 Tab 与标题）                  │
├─────────────────────────────────────────────────────┤
│ 右上角：[已提交 chip]   [提交到概念讨论 → 按钮]      │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ CanvasToolbar                                    │ │
│ │ [节点数 N] [活跃数 M] [显示淡化子节点] [重置]    │ │
│ │ [适配视图]                                       │ │
│ ├─────────────────────────────────────────────────┤ │
│ │                                                 │ │
│ │ WhatIfTree（React Flow 全屏）                    │ │
│ │                                                 │ │
│ │       ┌────┐                                     │ │
│ │       │根节点│ ──┬──> 子节点 1                   │ │
│ │       └────┘    ├──> 子节点 2（已选）            │ │
│ │                 └──> 子节点 3（淡化）            │ │
│ │                                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ NodeDetailPanel（选中节点时抽屉式显示）──────────┐│
│ │  节点内容 + 新颖度评分 + 建议                    ││
│ │  [选择为分支] [展开] [评估] [选入路径]           ││
│ │  [获取变异建议] [应用变异: inversion/...]        ││
│ └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 关键组件

| 组件 | 职责 |
|---|---|
| `CreativeCanvasPage`（`pages/CreativeCanvasPage.tsx`）| 页面容器，调 `useCreativeCanvas` hook + 协调子组件 |
| `useCreativeCanvas`（`hooks/useCreativeCanvas.ts`）| 状态机 hook，封装 20+ 操作（init/expand/select/evaluate/mutate/regenerate/reset/commit） |
| `WhatIfTree` | React Flow 画布，支持节点拖拽、缩放、fit-view |
| `CanvasNode` | 节点卡片，显示 premise + children_ids + branch_status |
| `CanvasToolbar` | 节点计数 + 过滤选项 + 重置 / 适配视图 |
| `NodeDetailPanel` | 底部抽屉，展示选中节点的详细操作 |
| `ResetConfirmDialog` | 重置画布前确认 |
| `CanvasEmptyState` | canvas 未初始化时的引导页（输入 premise → 调 `/init`）|
| `NoveltyRadar` / `MutationSuggestion` | 评分雷达 + 变异建议展示 |

### 关键交互流

1. **首次进入**：canvas 为空 → 显示 `CanvasEmptyState` → 输入 premise（自动带出 `concept.premise` 默认值） → 点初始化 → `/init` 产出根节点
2. **展开节点**：点节点 → 选中 + 抽屉打开 → 点「展开」→ `/expand` 加子节点 → React Flow 自动布局
4. **选路径**：逐级点子节点 → `selected_path` 累积；底部抽屉显示「已选」状态
5. **变异节点**：点「获取变异建议」→ LLM 推荐 → 选 inversion/escalation/subversion → `/apply-mutation` → 新变体作为子节点挂上
6. **评分**：点「评估」→ `/evaluate` 单节点 4 维评分入 `novelty_scores`
7. **提交**：路径 ≥ 2 时「提交到概念讨论」按钮亮起 → `/commit` → 落库 `concept_and_dna.json` → 跳转 `/stage0`

---

## 3. 数据模型

### `canvas_state.json` schema v3

```json
{
  "schema_version": 3,
  "session_id": "uuid",
  "_etag": "16-char-hex",  // 乐观锁
  "raw_intent": {
    "prompt": "...", "genre_primary": "仙侠", "genre_secondary": "悬疑",
    "target_reader": "...", "reference_works": [...], "forbidden_directions": [...],
    "quick_mode": false, "trope_tags": [...] // 后台异步 LLM 提取
  },
  "root_node_id": "wi_001_00",
  "nodes": {
    "wi_001_00": {
      "id": "wi_001_00", "depth": 0, "parent_id": null, "content": "...",
      "trope_tags": [...], "saturation_warning": false, "novelty_score": null,
      "mutation_context": null, "children_ids": ["wi_001_01", ...],
      "is_expanded": true, "branch_status": "active"
    }
  },
  "edges": [{ "from", "to", "type": "mutation:fusion|inversion|..." }],
  "selected_path": ["wi_001_00", "wi_001_02"],
  "branch_choices": { "wi_001_00": "wi_001_02" },
  "core_contradiction": {
    "template_type": "ABILITY_VS_LIMIT", "statement": "...",
    "side_a": "...", "side_b": "...", "tension_score": 78,
    "is_custom": false, "confirmed_at": "..."
  },
  "novelty_scores": {
    "market_saturation": 0.7, "trope_similarity": 0.6,
    "contradiction_depth": 0.8, "discussion_potential": 0.5,
    "composite": 0.65, "computed_at": "...", "trope_extraction_status": "completed"
  },
  "idea_variants": [{
    "id": "var-xxx", "title": "...", "premise_one_line": "...",
    "mutation_type": "inversion|escalation|subversion|fusion",
    "mutation_logic": "...", "estimated_novelty": 0.7,
    "trope_tags": [...], "regenerated_count": 0,
    "risk_level": "medium",     // fusion 时才有
    "fusion_distance": 2        // fusion 时才有
  }],
  "session_metadata": {
    "created_at": "...", "last_modified_at": "...",
    "elapsed_seconds": 3600, "operation_count": 12
  },
  "created_at": "...", "updated_at": "...",
  "committed_at": null, "committed_concept_ref": null
}
```

### `concept_and_dna.json`（提交后）

```json
{
  "concept": { "title", "genre": "仙侠", "premise", "tone", "theme", "target_audience" },
  "story_dna": {
    "core_contradiction": { ... },
    "value_stack": [4 层：personal → social → philosophical → existential],
    "style_template": "...",
    "fusion_meta": {  // 仅副类型有值 + 有 fusion variant 时
      "secondary_genre": "悬疑", "risk_level": "medium", "distance": 2
    }
  },
  "source": "canvas",
  "canvas_snapshot": { "selected_path": [...], "committed_at": "..." }
}
```

### v2 → v3 自动迁移
`_read_canvas` 入口检测 `schema_version`，缺失字段补默认值（`core_contradiction=null`、`novelty_scores=null`、`idea_variants` 从 `mutation_context.mut` 标记提取、`session_metadata` 基于 `created_at` 推断、`raw_intent=null`）。

---

## 4. 后端引擎层（`backend/creative_os/`）

| 引擎 | 文件 | 职责 | LLM? |
|---|---|---|---|
| **WhatIfEngine** | `whatif_engine.py` | 生成根节点 + 树状展开（BFS depth=3, breadth=4） | LLM (Tier 1) |
| **MutationEngine** | `mutation_engine.py` | 3-op mutation（inversion/escalation/subversion）+ `fuse()` 双 trope 融合 | LLM (Tier 1) |
| **ContradictionEngine** | `contradiction_engine.py` | 5 模板（ABILITY_VS_LIMIT 等）矛盾展开 + 深度评分 | LLM (Tier 2) |
| **GenreFusionEngine** | `genre_fusion_engine.py` | BFS 距离矩阵（int 0-3 跳）+ `get_risk_level` 映射 | 纯计算，无 LLM |
| **NoveltyEvaluator** | `novelty_evaluator.py` | 4 维新颖度评分 + composite | LLM 仅 trope 提取（Tier 3, fire-and-forget） |
| **TropePool / IdeaPool** | `trope_pool.py` / `idea_pool.py` + `idea_pool_importer.py` | 类型 → trope 映射；Idea 沉淀（per-project，未来跨项目） | — |
| **PlannerAgent** | `backend/agents/planner.py` | `generate_concept_from_canvas`（`canvas_to_concept.yaml` 模板），调用上面所有引擎后整合输出 concept + story_dna | LLM (Tier 1) |

### 数据流（核心场景）

```
用户点根节点 → POST /whatif/expand {node_id, depth_target}
  └─► WhatIfEngine.expand(parent_node, depth)  → LLM 产子节点
       └─► canvas.nodes[...] += children
            canvas.edges += from→to

用户点「应用变异」→ POST /apply-mutation {node_id, op}
  └─► MutationEngine.mutate_idea(trope, op)  → LLM 产新 premise
       └─► _mutation_to_idea_variant(...) → canvas.idea_variants[] +=

用户点「评估」→ POST /evaluate {node_id}
  └─► NoveltyEvaluator.evaluate(...)
       └─► canvas.novelty_scores[node_id] = {4 维 + composite}

用户点「提交」→ POST /commit {session_id, confirmed_path_ids, ...}
  └─► PlannerAgent.generate_concept_from_canvas(canvas, genre)
       └─► LLM 用 canvas_to_concept.yaml 模板
            └─► 写 concept_and_dna.json + 双写 creative_divergence.json
```

---

## 5. 后端端点清单

所有路径前缀：`/api/v1/projects/{project_id}/creative/diverge`

| Method | Path | 用途 | Canvas 页使用位置 |
|---|---|---|---|
| POST | `/init` | 初始化画布 + 持久化 raw_intent | 空状态初始化按钮 |
| POST | `/apply-mutation` | 应用 mutation op 到节点，产新子节点 | 节点详情面板「应用变异」 |
| POST | `/expand` | 展开节点，产子节点（核心 What-If 操作） | 节点详情面板「展开」 |
| POST | `/choose-branch` | 标记父子节点间关系（哪个是当前 active 分支） | 节点详情面板「选择为分支」 |
| POST | `/select` | 更新 selected_path（路径多选） | 节点详情面板「选入路径」 |
| POST | `/evaluate` | 单节点 4 维评分 | 节点详情面板「评估」 |
| GET | `/state` | 读完整 canvas_state | 页面 mount 时 loadCanvas |
| DELETE | `/state` | 重置画布 | 重置按钮（带 ResetConfirmDialog） |
| POST | `/commit` | 生成 concept_and_dna + 双写 creative_divergence | 「提交到概念讨论」按钮 |
| GET | `/novelty` | 列表级新颖度评分（4 维 + composite）| Toolbar 可选汇总展示 |
| POST | `/fuse` | 类型融合（v1.3 接入）| 类型融合触发 |

### 路由层文件
`backend/api/creative_diverge.py`（原 `creative_canvas.py` 重命名，统一所有创意发散路由）。

### 旧 Path B 兼容端点（v1.1 起）
`/api/projects/{id}/creative-divergence/*` 4 个端点响应头加 `Deprecation: true` + `Sunset: 2026-12-31` + `Link: .../diverge/state; rel="successor-version"`，返回旧数据。v1.3 删除。

---

## 6. 前端实现要点

### 6.1 Hook 状态机

`useCreativeCanvas(projectId)` 维护的状态：

```ts
{
  status: "empty" | "initialized" | "loading",
  rootNodeId: string | null,
  nodes: Record<string, CanvasNode>,
  edges: CanvasEdge[],
  selectedNodeId: string | null,
  selectedPath: string[],
  branchChoices: Record<string, string>,
  noveltyScores: Record<string, NoveltyScoreDetail>,
  suggestion: string,
  error: string | null,
  positions: PositionMap,
  failedNodes: Record<string, FailedNode>,
  loadingNodes: Record<string, true>,
  mutationSuggestion: MutationSuggestionState | null,
  committedAt: string | null
}
```

暴露的方法：`loadCanvas / initCanvas / expandNode / selectNode / evaluateNode / selectPath / resetCanvas / chooseBranch / retryExpand / updatePosition / getMutationSuggestion / applyMutation / commitCanvas`。

### 6.2 路径持久化副作用

`CreativeCanvasPage` 维护 `lastSyncedPathRef`，仅在 `selectedPath` 实际变化时才 `api.selectPath()` 同步到后端——避免 mount 时把 server 已保存的路径重写一遍（会清掉 `committed_at` marker 导致「已提交」chip 消失）。这条修复来自 B2 fix 注释。

### 6.3 提交后跳转

`/commit` 成功后 `navigate(\`/project/${projectId}/stage0\`)` 落到概念讨论页。提交按钮在 `status === "initialized" && selectedPath.length >= 2 && !committing` 时亮起，tooltip 解释为何禁用。

### 6.4 乐观锁

所有写端点接收 `If-Match: <etag>` 请求头，后端不匹配返 409 `RACE_CONDITION`。

---

## 7. 当前状态与已知问题

| 状态项 | 详情 |
|---|---|
| **v1.1 + v1.2 重构** | 已基本完成（git log 上 8/30-8/31 多 commits），12 路由齐全 |
| **v1.3 类型融合接线** | spec 已写（spec/2026-09-01-genre-fusion-wiring-design），plan 已写（plans/2026-09-01-genre-fusion-wiring.md），**代码尚未落地** |
| **已知 GENRES vs catalog 不匹配** | 前端中文显示名（10 项）vs backend catalog ID（7 项），选"修仙"会被 catalog fallback 到"爽文"。本 spec 不修，留后续 PRD 决策 |
| **Path B 弃用** | v1.1+ 加 Deprecation 头，v1.3 删除（不在 v1.1+v1.2 范围） |
| **跨项目 IdeaPool 查询** | 未实现，per-project 而已 |
| **24h 草稿自动归档** | 未实现，spec §9.3 留 placeholder |

最近 commits（`nebula` 分支）几乎全是 divergence 相关修复（`d280381 / 84d2a30 / 273d627 / fb9a5ae / 4184acd / dba5d55` 等），说明这块正处收尾 + 稳定化阶段。

---

## 8. 涉及的文件索引

### 前端核心

```
frontend/src/
├── pages/
│   └── CreativeCanvasPage.tsx                    # 独立画布页面
├── hooks/
│   └── useCreativeCanvas.ts                      # 状态机 hook
├── api/
│   └── client.ts                                 # /diverge 12 端点封装
└── components/
    └── creative-canvas/
        ├── WhatIfTree.tsx                         # React Flow 画布
        ├── CanvasNode.tsx                         # 节点卡片
        ├── CanvasToolbar.tsx                      # 顶部工具条
        ├── CanvasEmptyState.tsx                   # 空状态引导
        ├── NodeDetailPanel.tsx                    # 底部抽屉
        ├── ResetConfirmDialog.tsx                 # 重置确认
        ├── NoveltyRadar.tsx                       # 新颖度雷达
        └── MutationSuggestion.tsx                 # 变异建议
```

### 后端核心

```
backend/
├── api/
│   └── creative_diverge.py                        # 路由层（12 端点）
├── creative_os/
│   ├── whatif_engine.py                           # WhatIfEngine
│   ├── mutation_engine.py                         # MutationEngine (含 fuse)
│   ├── contradiction_engine.py                    # ContradictionEngine
│   ├── genre_fusion_engine.py                     # GenreFusionEngine
│   ├── novelty_evaluator.py                       # NoveltyEvaluator
│   ├── trope_pool.py                              # 类型 → trope 映射
│   ├── idea_pool.py                               # idea 沉淀
│   └── idea_pool_importer.py                      # variants → Idea 适配
├── models/
│   └── creative_os.py                             # Pydantic 模型
├── agents/
│   ├── creative_director.py
│   └── planner.py                                 # generate_concept_from_canvas
└── prompts/
    └── canvas_to_concept.yaml                     # /commit 阶段提示模板
```

### Spec / Plan 文档

```
docs/
├── design/
│   └── 创意发散系统PRD_v1.0.docx                   # 上游 PRD
└── superpowers/
    ├── specs/
    │   ├── 2026-08-30-creative-divergence-refactor-design.md
    │   └── 2026-09-01-genre-fusion-wiring-design.md
    └── plans/
        └── 2026-09-01-genre-fusion-wiring.md
```

---

## 9. 一句话总结

创意画布 = **CreativeOS 5 大引擎**（WhatIf / Mutation / Contradiction / GenreFusion / Novelty）通过 **`/creative/diverge/*` 路由层**驱动 **`canvas_state.json` v3 单一真相源**，前端 `/stage0/canvas` 路由下用 React Flow 全屏画布承载 **展开 / 变异 / 评分 / 选路径 / 提交** 全套交互，15 分钟把模糊灵感收拢成带矛盾 + 带路径 + 带新颖度评分的可提交 concept，落库后接 Stage 1 概念讨论。当前 v1.1+v1.2 已落地，v1.3 类型融合接线 spec 已完成待实施。