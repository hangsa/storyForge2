# Creative Canvas v2.0 重构 Spec

> 上游 PRD:[`/docs/design/creative-canvas-reconstruction.md`](../design/creative-canvas-reconstruction.md)
> 范围:Creative Canvas v2.0 MVP — 固定 5 步路径、3 选项/步、AI 自动选操作、Step 状态机、v4 schema 迁移
> 不在范围:早收束、用户 override AI 推荐、Regenerate、分支回溯、concept_and_dna.json 新增字段写、下游 ConceptStep 等消费者升级（全部 v2.1+）

---

## 1. 背景与目标

### 1.1 当前 gap

v1.x 创意画布采用 WhatIfTree 模型（`backend/api/creative_diverge.py:5-6` 顶部 docstring + `:642-644` init 调用 + `:788-798` expand 调用 `WhatIfEngine.expand_node`），通过 `WhatIfEngine.expand(parent_node, depth)` BFS 展开 4^N 个节点（depth=3, breadth=4）。这种模型存在三个核心问题：

| 问题 | 用户表现 | 根因 |
|---|---|---|
| **创意空间 vs 创意过程错位** | 用户面对 4^N 节点不知道下一步做什么 | 树模型缺乏明确演进逻辑 |
| **空路径 commit bug** | selectedPath=[] 时 UI 仍可点「5. 提交」 → POST /commit 422 | Step 状态机只有「可选 / 已选」两态，无 STALE 检测（参 memory `project_divergence_a_to_e_empty_path.md`）|
| **5 引擎能力被埋没** | WhatIf 树核心循环中 Mutation/Contradiction/Fusion/Novelty 调用零散 | 6 类创作行为（扭曲/打破/融合/反转/升级/收束）在产品层没显式抽象，用户找不到入口 |

### 1.2 v2.0 重构目标

| 目标 | 验收标准 |
|---|---|
| **从「探索树」变「创意路径生成器」」 | 用户走完 5 步形成 creative_path，路径可可视化 |
| **3 选项硬约束** | 每步固定生成 3 个候选（保守/意外/激进 差异化）|
| **AI 自动选操作** | 单次 LLM 调用返回 (operation + reasoning + options[3]) |
| **Step 状态机 5 态** | LOCKED/AVAILABLE/ACTIVE/COMPLETED/STALE + 显式 transition rule |
| **v3 → v4 schema lazy migration** | 已有 canvas_state.json 不丢失；committed 项目不被覆盖 |
| **下游契约 100% 兼容** | concept_and_dna.json 输出 schema 不变（v3 兼容）|
| **修复空路径 commit bug** | commit 校验 selectedPath + 全步骤 COMPLETED，STALE 一律拒收 |

### 1.3 不在范围（v2.1+ 推迟）

PRD §28.2 明确推迟项：

- 早收束（v2.1 + SKIPPED 状态）
- 用户主动 override AI 推荐
- 分支回溯
- Regenerate
- concept_and_dna.json 写 creative_path / creative_mechanism / canvas_meta 三个 v2 新增字段
- 下游消费者升级（ConceptStep 注入 creative_path 等）

PRD §28.3 明确不做项：

- 无限树 / 任意拖拽节点 / 手工连接节点 / 复杂节点编辑
- 用户自定义 mutation pipeline
- 多人协作
- 跨项目 IdeaPool
- 24h 草稿自动归档

### 1.4 v2.0 与 v1.3 类型融合的依赖关系

`docs/superpowers/specs/2026-09-01-genre-fusion-wiring-design.md`（v1.3）尚未落地。v2.0 实施时必须二选一：

- **选项 A（推荐）**：先完成 v1.3（在 v1.x 上落 `/fuse` + raw_intent 持久化），再做 v2
- **选项 B**：跳过 v1.3，直接在 v2 中实现 fuse 操作

选项 A 降低 v2 实施风险。本 spec 默认 v1.3 已落地，但 v2 实施时确认。

---

## 2. 顶层架构

```
                                    前端
                                    ──
                                    ▼
              ┌─────────────────────────────────────────┐
              │ CreativeCanvasPage (v2 重写)            │
              │  ┌──────────────────────────────────┐   │
              │  │ HorizontalPathCanvas             │   │
              │  │   IDEA → STEP1 → STEP2 → STEP3  │   │
              │  │          → STEP4 → STEP5        │   │
              │  ├──────────────────────────────────┤   │
              │  │ ActiveStepPanel                  │   │
              │  │   OperationHeader + Options[3]   │   │
              │  ├──────────────────────────────────┤   │
              │  │ QualityBar (新颖度/冲突/潜力)   │   │
              │  └──────────────────────────────────┘   │
              │  useCreativeCanvasV2 hook               │
              │   loadCanvas / nextStep / select / commit│
              └────────────────┬────────────────────────┘
                               │ HTTP
                               ▼
              ┌─────────────────────────────────────────┐
              │ /api/v1/projects/{id}/creative/canvas/* │
              │  /session/init   (raw_intent 双写)      │
              │  /session/next-step  (NEW)              │
              │  /session/select   (NEW)                │
              │  /session/state    (lazy migrate)       │
              │  /session/state    (DELETE 重置)        │
              │  /session/commit   (v3 兼容输出)        │
              └────────────────┬────────────────────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
        MutationEngine   ContradictionEngine   GenreFusionEngine
              │                │                 │
              └────────────────┼─────────────────┘
                               ▼
                  Candidate Generator
                  (LLM 单次调用返回 op + options[3])
                               ▼
                          3 Options → User
```

### 2.1 v2.0 模块边界

| 模块 | 负责 | 不负责 |
|---|---|---|
| `HorizontalPathCanvas` | 横向路径可视化 + Step 状态展示 | 选项内容渲染 |
| `ActiveStepPanel` | 当前 Step 的 operation 标题 + 3 个选项卡片 | 路径总览 |
| `useCreativeCanvasV2` | session state + loadCanvas/nextStep/select/commit 状态机 | UI 渲染 |
| `next-step` 端点 | 单次 LLM 调用产出 (op, reason, options[3]) | 多步协同 |
| `commit` 端点 | 校验 + 写 concept_and_dna.json (v3 兼容) | final_concept 生成（v2.0 由 commit 端点同步生成，详见 §5.4）|

---

## 3. 数据模型

### 3.1 canvas_state.json v4 schema

```json
{
  "schema_version": 4,
  "session_id": "uuid",
  "_etag": "16-char-hex",

  "root_idea": {
    "prompt": "...",
    "genre": "仙侠",
    "premise": "...",
    "extracted": {
      "genre": "仙侠",
      "core_elements": ["修仙", "时间", "自我"],
      "potential_conflict": "现在 vs 未来"
    }
  },

  "raw_intent": {
    "prompt": "...",
    "genre_primary": "仙侠",
    "genre_secondary": null,
    "target_reader": null,
    "reference_works": [],
    "forbidden_directions": [],
    "quick_mode": false,
    "trope_tags": []
  },

  "creative_session": {
    "current_step": 3,
    "max_steps": 5,
    "status": "active|completed|committed|aborted"
  },

  "creative_path": [
    {
      "step": 1,
      "operation": "twist",
      "operation_reason": "...",
      "options": [
        { "id": "option_1_a", "title": "...", "premise": "...", "scores": {...} },
        { "id": "option_1_b", "title": "...", "premise": "...", "scores": {...} },
        { "id": "option_1_c", "title": "...", "premise": "...", "scores": {...} }
      ],
      "selected_option_id": "option_1_b",
      "created_at": "...",
      "selected_at": "...",
      "regenerated_count": 0,
      "state": "completed"
    },
    ...
  ],

  "current_concept": {
    "premise": "...",
    "core_conflict": "...",
    "characters": [],
    "world_rules": [],
    "tropes": [],
    "themes": [],
    "novelty": 0.82
  },

  "final_concept": null,
  "committed": false,
  "committed_at": null,
  "committed_concept_ref": "concept_and_dna.json",

  "scores": {
    "novelty": 0.82,
    "conflict": 0.91,
    "story_potential": 0.87,
    "uniqueness": 0.84,
    "computed_at": "..."
  },

  "session_metadata": {
    "created_at": "...",
    "last_modified_at": "...",
    "elapsed_seconds": 3600,
    "operation_count": 12
  }
}
```

### 3.2 v3 → v4 迁移规则

迁移由 `_migrate_v3_to_v4` 在 `_read_canvas`（`creative_diverge.py:82`）入口按需调用：

| v3 字段 | v4 字段 | 转换逻辑 |
|---|---|---|
| `raw_intent` | 顶层 `raw_intent` + `root_idea` | 直接复制 raw_intent；同时从 prompt/genre_primary/trope_tags 派生 root_idea |
| `root_node_id` | （删除）| 仅在 v4 view 中忽略 |
| `nodes` | （删除）| 全部节点信息按 `selected_path` 顺序提取为 creative_path[].selected_option |
| `edges` | （删除）| 关系信息隐含在 creative_path 顺序中 |
| `selected_path` | `creative_path[i-1].selected_option_id` | i=1 取根节点，i>1 取 `branch_choices[selected_path[i-1]]` |
| `branch_choices` | （删除）| 隐含在 selected_option_id 中 |
| `core_contradiction` | `current_concept.core_conflict` 或 `final_concept.core_contradiction` | 若已 commit → final_concept；否则迁到 current_concept |
| `novelty_scores` | `scores` | 直接映射 4 维 + composite |
| `idea_variants` | 第一个 fusion variant 仍写入（`fusion_meta` 推断）| 详见 §3.3 |
| `committed_at` / `committed_concept_ref` | 保留 | 不变 |
| `_etag` | 保留 | 重新计算（迁移过程改了内容）|

#### 迁移伪代码

```python
def _migrate_v3_to_v4(canvas: dict) -> dict:
    """Lazy migration. 纯函数，不修改入参。"""
    v3 = canvas
    v4 = {
        "schema_version": 4,
        "session_id": v3.get("session_id"),
        "root_idea": _build_root_idea_from_raw_intent(v3.get("raw_intent", {})),
        "raw_intent": v3.get("raw_intent", {}),
        "creative_session": {
            "current_step": len(v3.get("selected_path", [])) or 1,
            "max_steps": 5,
            "status": "committed" if v3.get("committed_at") else "active",
        },
        "creative_path": _build_creative_path_from_v3(v3),
        "current_concept": _build_current_concept_from_v3(v3),
        "final_concept": v3.get("core_contradiction") if v3.get("committed_at") else None,
        "committed": bool(v3.get("committed_at")),
        "committed_at": v3.get("committed_at"),
        "committed_concept_ref": v3.get("committed_concept_ref"),
        "scores": v3.get("novelty_scores", {}),
        "session_metadata": v3.get("session_metadata", {}),
    }
    v4["_etag"] = _compute_etag(v4)
    return v4


def _build_creative_path_from_v3(v3: dict) -> list:
    """从 selected_path + nodes + branch_choices 重建 creative_path。"""
    selected_path = v3.get("selected_path", [])
    nodes = v3.get("nodes", {})
    branch_choices = v3.get("branch_choices", {})
    creative_path = []
    for i, node_id in enumerate(selected_path):
        node = nodes.get(node_id, {})
        # i=0 是根节点；i>0 是 branch_choices[prev] 选的子节点
        if i == 0:
            opt_id = "option_root"
        else:
            opt_id = f"option_{i}_{branch_choices.get(selected_path[i-1], 'unknown')}"
        creative_path.append({
            "step": i + 1,
            "operation": "twist",  # 默认占位，v2.0 不知道 v3 用的是哪个 op
            "operation_reason": "migrated_from_v3",
            "options": [{
                "id": opt_id,
                "title": node.get("title", node.get("content", "")[:30]),
                "premise": node.get("content", ""),
                "logic": "",
                "scores": {"novelty": node.get("novelty_score", 0)},
            }],
            "selected_option_id": opt_id,
            "created_at": node.get("created_at", ""),
            "selected_at": node.get("selected_at", ""),
            "regenerated_count": 0,
            "state": "completed",
        })
    return creative_path
```

### 3.3 已 commit 项目的迁移策略

如果 `v3.committed_at != null`（即 concept_and_dna.json 已存在）：

| 操作 | 行为 |
|---|---|
| `_read_canvas` | 调用 `_migrate_v3_to_v4` 返回 v4 view（纯只读，不写盘）|
| 任何写操作 | 拒绝，返 409 `CANVAS_ALREADY_COMMITTED` |
| 自动写回 | **不写**。committed 项目的 canvas_state.json 保持 v3 格式不污染 |

实现：

```python
def _read_canvas(project_id: str) -> Optional[dict]:
    canvas = _get_fm().read_json(project_id, "canvas_state.json")
    if canvas is None:
        return _empty_canvas_v4()
    if canvas.get("schema_version") == 4:
        return canvas
    if canvas.get("schema_version") == 3:
        v4 = _migrate_v3_to_v4(canvas)
        # 已 commit 的项目不写回——避免覆盖历史
        if not v4.get("committed"):
            _write_canvas(project_id, v4)
        return v4
    raise HTTPException(409, "UNKNOWN_SCHEMA_VERSION")
```

`_write_canvas`（`creative_diverge.py:118`）需要新增 `write_through: bool = True` 参数：

```python
def _write_canvas(project_id: str, data: dict, write_through: bool = True) -> None:
    data["_etag"] = _compute_etag(data)
    if not write_through:
        return  # 调用方已确认是 view，不持久化
    # ... 原写入逻辑
```

### 3.4 v1.x 引擎层的兼容

v2.0 复用现有 5 个 engine（不新增、不删除）：

| 引擎 | v2 调用方式 |
|---|---|
| `MutationEngine.mutate(trope, op)` | 由 `next-step` 在选 op=twist/escalate 时调用作为 op 候选生成参考 |
| `MutationEngine.fuse(trope_a, trope_b)` | 由 `next-step` 在选 op=fuse 时调用 |
| `ContradictionEngine.expand(text, template)` | 由 `next-step` 在选 op=break/invert 时调用 |
| `GenreFusionEngine.compute_distance(primary, secondary)` | 由 `next-step` 在选 op=fuse 时调用 |
| `NoveltyEvaluator.evaluate(canvas)` | 由 `next-step` 在生成 options 时 fire-and-forget 调用 |

### 3.5 v2.0 阶段仍保留 v3 字段的兼容性

`canvas_state.json` v4 中**仅删除** v3 字段：

```python
_V3_FIELDS_TO_DROP = {
    "root_node_id", "nodes", "edges", "selected_path",
    "branch_choices", "core_contradiction", "novelty_scores",
    "idea_variants",
}
```

**保留**的 v3 字段：

- `raw_intent`（详见 §3.6）
- `_etag`（乐观锁）
- `committed_at` / `committed_concept_ref`

### 3.6 raw_intent 保留决策

`raw_intent` 是 v3 init 端点的输入契约。删除会导致前端 `WizardSidebar` / `InitRequest` 报 422（参 memory `feedback_frontend_mock_hides_contract_drift.md`）。

**v2.0 决策**：保留 raw_intent 作为 v4 顶层字段，与 root_idea 双写。

```python
# init 端点
canvas["raw_intent"] = data.raw_intent.dict()
canvas["root_idea"] = {
    "prompt": data.raw_intent.prompt,
    "genre": data.raw_intent.genre_primary,
    "premise": data.raw_intent.prompt,
    "extracted": {"core_elements": data.raw_intent.trope_tags or []},
}
```

---

## 4. Step 状态机

### 4.1 5 态定义

| 状态 | 含义 | UI 视觉 | 后端字段位置 |
|---|---|---|---|
| `LOCKED` | 前置未完成，无法进入 | 灰色未来占位 | `creative_path[i].state` |
| `AVAILABLE` | 前置完成，可被激活 | 描边卡片，未展开 | `creative_path[i].state` |
| `ACTIVE` | 当前用户正在交互 | 高亮强调，3 选项卡片展开 | `creative_path[i].state` |
| `COMPLETED` | 用户已选择一项 | ✓ 标记，可点击查看 | `creative_path[i].state` |
| `STALE` | 上游回溯/重生导致产物失效 | 警告色，禁用提交 | `creative_path[i].state` |

### 4.2 状态转移规则

```python
def transition_step_state(canvas: dict, step: int, event: str) -> None:
    """所有状态变更走这一个函数，确保转移规则集中。"""
    path = canvas["creative_path"]
    if event == "init":
        for i, p in enumerate(path):
            p["state"] = "locked"
        path[0]["state"] = "available" if len(path) == 1 else "locked"
    elif event == "activate":
        path[step - 1]["state"] = "active"
    elif event == "complete":
        path[step - 1]["state"] = "completed"
        if step < len(path):
            path[step]["state"] = "available"
    elif event == "backtrack_from":  # v2.1 启用
        for i in range(step - 1, len(path)):
            path[i]["state"] = "stale" if i >= step else path[i]["state"]
    # 错误：COMPLETED → ACTIVE 不允许直接发生
```

转移规则对应表：

```text
init                      → 所有步骤 LOCKED；Step 1 = AVAILABLE（特例）
Step i AVAILABLE → ACTIVE  (用户点击「继续」/next-step 端点被调用)
Step i ACTIVE → COMPLETED  (用户调用 select 端点选定一项)
Step i COMPLETED → Step i+1 AVAILABLE  (select 端点副作用)
Step i ACTIVE → COMPLETED + Step i+1..5 STALE  (v2.1 回溯；v2.0 不发生)
```

### 4.3 关键不变量

```python
def _validate_step_invariants(canvas: dict) -> None:
    path = canvas["creative_path"]
    if len(path) > 5:
        raise ValueError("creative_path 超过 5 步")
    # Step 1 必须存在
    if not path or path[0]["step"] != 1:
        raise ValueError("creative_path 必须以 Step 1 开头")
    # 任何 STALE 步骤不允许 commit
    if any(p["state"] == "stale" for p in path):
        raise ValueError("存在 STALE 步骤，需要回回溯")
    # COMPLETED 步骤必须有 selected_option_id
    for p in path:
        if p["state"] == "completed" and not p.get("selected_option_id"):
            raise ValueError(f"Step {p['step']} COMPLETED 但无 selected_option_id")
```

### 4.4 错误防护（修复 v1.x bug）

参 memory `project_divergence_a_to_e_empty_path.md`：v1.x 中 StepIndicator 在 selectedPath=[] 时仍显示「5. 提交」可点击。

v2.0 修复：

1. **前端**：`CommitButton` 启用条件 = `Step N (N≤5) COMPLETED + Step N+1..5 ∈ {LOCKED, COMPLETED} + 无 STALE`
2. **后端**：`commit` 端点 server 校验：

```python
def _validate_for_commit(canvas: dict) -> None:
    """校验可提交的 canvas 状态。

    注意：此函数**不**校验 final_concept 是否非空——
    final_concept 在 commit step 2 才生成，commit step 1 调用本函数时
    final_concept 必然为空。生成后的校验见 §5.4 commit step 3。
    """
    path = canvas.get("creative_path", [])
    completed = [p for p in path if p["state"] == "completed"]
    if len(completed) < 2:
        raise HTTPException(422, "INVALID_PATH: 至少需要 2 步 COMPLETED")
    stale = [p for p in path if p["state"] == "stale"]
    if stale:
        raise HTTPException(422, f"INVALID_PATH: {len(stale)} 个 STALE 步骤需要处理")
    # Step 5 必须 COMPLETED（v2.0 不支持早收束）
    step5 = next((p for p in path if p["step"] == 5), None)
    if not step5 or step5["state"] != "completed":
        raise HTTPException(422, "INVALID_PATH: Step 5 必须走完")
```

---

## 5. API 设计

### 5.1 端点清单

v2.0 端点命名空间从 `/creative/diverge/*` 改为 `/creative/canvas/*`（沿用 v1.x canvas 路由前缀，避免与 wizard step 1 的 divergence 子路径冲突）。

| Method | Path | 用途 | 替代的 v1.x 端点 | 状态 |
|---|---|---|---|---|
| POST | `/creative/canvas/session/init` | 初始化 session，接收 raw_intent | `/init` | 复用 + 双写 root_idea |
| POST | `/creative/canvas/session/next-step` | 生成下一步的 operation + 3 options | `/expand` + 部分 `/apply-mutation` | **新增** |
| POST | `/creative/canvas/session/select` | 用户选择某选项，触发下一步生成 | `/select` + `/choose-branch` | 合并 |
| GET | `/creative/canvas/session/state` | 读取 canvas_state（lazy migrate v4） | `/state` | 复用 |
| DELETE | `/creative/canvas/session/state` | 重置 session（保留 root_idea） | `/state` (DELETE) | 复用 |
| POST | `/creative/canvas/session/commit` | 写 concept_and_dna.json (v3 兼容 schema) | `/commit` | 复用 |
| POST | `/creative/canvas/session/evaluate` | 单选项评分（自动后台调用）| `/evaluate` | 改为 fire-and-forget |
| POST | `/creative/canvas/regenerate` | 重新生成当前 step 的 3 个选项 | 无 | v2.1 |
| POST | `/creative/canvas/backtrack` | 回溯到历史 step | 无 | v2.1 |
| POST | `/creative/canvas/finalize` | 触发 final_concept 生成 | 无 | v2.1 |

### 5.2 next-step 协议（新增）

**请求**：

```json
{
  "session_id": "...",
  "current_step": 2
}
```

**响应**：

```json
{
  "step": 3,
  "operation": {
    "type": "fusion",
    "name": "融合",
    "reason": "当前创意需要引入外部冲突"
  },
  "options": [
    {
      "id": "opt_3_a",
      "title": "修士通过调查自己的未来尸体",
      "premise": "...",
      "logic": "...",
      "scores": { "novelty": 0.82, "conflict": 0.91, "potential": 0.87 }
    },
    { "id": "opt_3_b", "...": "..." },
    { "id": "opt_3_c", "...": "..." }
  ],
  "quality_warning": null
}
```

**后端处理**：

1. 读 canvas_state，校验 current_step 与 creative_session.current_step 一致
2. 计算 `candidate_operation_hint`（详见 §6.2）
3. 调用 LLM 单次，prompt 见 §6.3
4. 解析返回 JSON，写入 `creative_path[current_step]`
5. 更新 state 为 `active`
6. fire-and-forget 调 NoveltyEvaluator 给每个 option 评分
7. 返回 response

### 5.3 select 协议

**请求**：

```json
{
  "session_id": "...",
  "step": 3,
  "option_id": "opt_3_b"
}
```

**后端处理**：

1. 读 canvas_state，校验 step 对应 path[i] 存在
2. 校验 option_id 在 path[i].options 内
3. 校验 path[i].state ∈ {available, active}
4. 写 `path[i].selected_option_id = option_id`，`state = completed`，`selected_at = now`
5. 更新 `current_concept`（基于 selected option 的 premise 派生）
6. 如果 current_step < 5：自动调 next-step 生成 Step current_step+1
7. 如果 current_step == 5：current_concept 收尾（**不**生成 final_concept，留给 commit 端点）
8. 写回 canvas_state

### 5.4 commit 协议

**请求**：

```json
{
  "session_id": "..."
}
```

**后端处理（v2.0 兼容输出）**：

> **v2.0 行为变更**：v1.x commit 端点接收可选 `confirmed_path_ids` / `value_stack_override` / `user_notes`（见 `creative_diverge.py:1814-1817`），v2.0 不再支持——所有数据从 canvas_state 派生；如有需要通过其他途径提供。

1. 校验：`_validate_for_commit(canvas)`（见 §4.4，**不含 final_concept 检查**——此时还未生成）
2. 调用 `PlannerAgent.generate_concept_from_canvas(canvas, genre)` 生成 `final_concept`（v2.0 不拆分到独立 `/finalize` 端点，详见 PRD §27.5）
3. 校验：生成出的 `final_concept` 非空（PlannerAgent 输出 gate）
4. **v2.0 不派生 creative_path 摘要**（PRD §28.1 MVP 范围）
5. 写 `concept_and_dna.json`（v3 schema，不写 creative_path/creative_mechanism/canvas_meta）
6. 双写 `creative_divergence.json`
7. canvas_state 标 committed_at = now，`committed_concept_ref = "concept_and_dna.json"`
8. 失败回滚：若 concept_and_dna 写入失败但 canvas_state 已标 committed，留待下次 commit 覆盖（v1.x 行为保留，详见 `creative_diverge.py:2057-2069`）

**响应**：

```json
{
  "ok": true,
  "committed_at": "...",
  "concept_ref": "concept_and_dna.json"
}
```

### 5.5 state 协议（lazy migration）

**请求**：`GET /creative/canvas/session/state`

**响应**：

```json
{
  "schema_version": 4,
  "session_id": "...",
  "_etag": "...",
  "root_idea": {...},
  "creative_session": {...},
  "creative_path": [...],
  "current_concept": {...},
  "final_concept": null,
  "committed": false,
  ...
}
```

**懒迁移行为**：

- 读到 v4 canvas → 原样返回
- 读到 v3 canvas → 调 `_migrate_v3_to_v4` 返回 v4 view；若未 committed 则写回 v4
- 读到 v3 已 committed → 调 `_migrate_v3_to_v4` 返回 v4 view 但**不写回**（详见 §3.3）

### 5.6 init 协议（raw_intent 双写）

**请求**：

```json
{
  "prompt": "...",
  "genre_primary": "仙侠",
  "genre_secondary": null,
  "target_reader": null,
  "reference_works": [],
  "forbidden_directions": [],
  "quick_mode": false
}
```

**响应**：

```json
{
  "ok": true,
  "session_id": "...",
  "etag": "..."
}
```

**后端处理**：

```python
async def init_canvas(project_id: str, request: InitRequest):
    canvas = {
        "schema_version": 4,
        "session_id": str(uuid.uuid4()),
        "raw_intent": request.dict(),
        "root_idea": {
            "prompt": request.prompt,
            "genre": request.genre_primary,
            "premise": request.prompt,
            "extracted": {"core_elements": request.trope_tags or []},
        },
        "creative_session": {
            "current_step": 1,
            "max_steps": 5,
            "status": "active",
        },
        "creative_path": [{
            "step": 1,
            "operation": None,  # 待 next-step 生成
            "operation_reason": None,
            "options": [],
            "selected_option_id": None,
            "created_at": now_iso(),
            "selected_at": None,
            "regenerated_count": 0,
            "state": "available",
        }],
        "current_concept": {...},
        "final_concept": None,
        "committed": False,
        "scores": {},
        "session_metadata": {
            "created_at": now_iso(),
            "last_modified_at": now_iso(),
            "elapsed_seconds": 0,
            "operation_count": 0,
        },
    }
    canvas["_etag"] = _compute_etag(canvas)
    _write_canvas(project_id, canvas)
    return {"ok": True, "session_id": canvas["session_id"], "etag": canvas["_etag"]}
```

---

## 6. AI 操作选择机制

### 6.1 单次 LLM 调用契约

v2.0 **单次调用**同时返回 operation + reasoning + options[3]，避免分两步调用导致延迟翻倍：

```text
输入:  current_concept + selected_path + current_step + max_steps + candidate_operation_hint
输出:  { operation, operation_reason, options[3] }
```

不再分两步（先选 op，再为 op 生成 options），减少 50% 延迟与 token 成本。

### 6.2 candidate_operation_hint 计算（backend 确定性规则）

```python
def compute_op_hint(concept: dict, path: list, step: int) -> str:
    """确定性规则，不依赖 LLM。LLM 看到 hint 后可微调。"""
    # Step 5 永远是 dramaturgy
    if step >= 5:
        return "dramaturgy"
    # 新颖度低 → 扭曲
    if concept.get("novelty", 0) < 0.5:
        return "twist"
    # 缺少冲突 → 打破
    if "冲突" not in (concept.get("core_conflict") or "") and \
       "矛盾" not in (concept.get("core_conflict") or ""):
        return "break"
    # 单类型 → 融合
    if len(concept.get("genres", [])) < 2:
        return "fuse"
    # 走到第 4 步且路径中无反转 → 反转
    if step >= 3 and not any(p["operation"] == "invert" for p in path):
        return "invert"
    # 冲突存在但规模小 → 升级
    if concept.get("conflict_scale") in ("personal", None):
        return "escalate"
    # 默认
    return "twist"
```

LLM 看到 `candidate_operation_hint` 后可微调（例如把 `twist` 改为 `break`），但返回的 `operation` 必须与 `operation_reason` 自洽。

### 6.3 next-step prompt 草稿

```yaml
system: |
  你是创意推演引擎。根据当前创意状态，决定下一步最有价值的创意操作，
  并生成 3 个候选方向。

  你的输出必须是合法 JSON：
  {
    "operation": "twist|break|fuse|invert|escalate|dramaturgy",
    "operation_reason": "为什么选这个操作（30 字内）",
    "options": [
      { "id": "opt_a", "title": "...", "premise": "...", "logic": "..." },
      { "id": "opt_b", "title": "...", "premise": "...", "logic": "..." },
      { "id": "opt_c", "title": "...", "premise": "...", "logic": "..." }
    ]
  }

  三个选项必须：
  1. 保持当前创意的核心
  2. 产生明显不同的剧情可能
  3. 有明确的因果变化
  4. 能够继续向下游发展
  5. 三者之间存在显著差异（按操作类型自适应，见 PRD §7 表）

user: |
  current_concept: {premise, core_conflict, characters, world_rules, tropes, themes}
  selected_path: [...前序 steps 摘要，每条 ≤ 30 字...]
  current_step: N
  max_steps: 5
  candidate_operation_hint: {auto | twist | break | fuse | invert | escalate}
```

### 6.4 三选项的差异轴（按操作类型自适应）

| 操作 | A | B | C |
|---|---|---|---|
| twist | 改变单一关键条件 | 改变条件之间的因果 | 改变整个设定基础 |
| break | 规则在边界条件下失效 | 规则被反噬 | 规则不存在 |
| fuse | 表面元素融合（道具/场景）| 类型规则融合（探案机制）| 世界观融合（物理规则）|
| invert | 角色立场反转 | 因果反转 | 主题反转 |
| escalate | 个人级别升级 | 社会级别升级 | 文明/宇宙级别升级 |
| dramaturgy | 简洁 premise | 复杂 premise | 主题化 premise |

### 6.5 失败处理（v2.0 MVP 范围）

| 失败模式 | v2.0 处理 |
|---|---|
| LLM 返回 JSON 解析失败 | 自动重试 1 次（**重试间隔 0**，紧接首次失败），附 `Please return valid JSON only`；再次失败返 503 `GENERATION_FAILED` |
| 三个选项相似度过高（premise 余弦相似度 > 0.85） | 在响应中标 `quality_warning: "options_too_similar"`，UI 提示用户回溯或接受当前候选 |
| 连续多次相似 | UI 显示「AI 暂时给不出新方向，是否 commit 当前最佳？」 |
| 用户主动 Regenerate | **不实现**（v2.1 启用） |

---

## 7. UI 改造

### 7.1 路由变更

| 旧 | 新 |
|---|---|
| `/project/:id/canvas`（WhatIfTree 全屏）| `/project/:id/canvas`（HorizontalPathCanvas 全屏）|
| 路由不变 | 仅组件替换 |

### 7.2 前端文件变更清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `frontend/src/pages/CreativeCanvasPage.tsx` | 重写 | 替换 WhatIfTree 为 HorizontalPathCanvas |
| `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx` | 新增 | 横向路径画布 |
| `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` | 新增 | 当前 Step 选项卡片 |
| `frontend/src/components/creative-canvas/QualityBar.tsx` | 新增 | 评分条 |
| `frontend/src/components/creative-canvas/WhatIfTree.tsx` | **删除** | v2 不再需要 |
| `frontend/src/components/creative-canvas/CanvasNode.tsx` | **删除** | 同上 |
| `frontend/src/components/creative-canvas/CanvasToolbar.tsx` | 重写 | 移除节点计数 |
| `frontend/src/components/creative-canvas/NodeDetailPanel.tsx` | **删除** | 抽屉被 ActiveStepPanel 取代 |
| `frontend/src/hooks/useCreativeCanvas.ts` | 重命名 | 改为 `useCreativeCanvasV2.ts` |
| `frontend/src/api/client.ts` | 扩展 | 加 `nextStepCanvas` / `selectCanvasOption` 等方法 |

### 7.3 横向路径画布（HorizontalPathCanvas）

```text
┌──────────────────────────────────────────────────────────┐
│ Creative Canvas                          创意深度 3 / 5   │
│ 把一个 Idea 逐步推演成独特的剧情创意                       │
├──────────────────────────────────────────────────────────┤
│  IDEA       STEP 1      STEP 2      STEP 3                │
│  ┌───┐      ┌───┐       ┌───┐       ┌───┐                │
│  │   │──────│ ✓ │───────│ ✓ │───────│ ● │                │
│  └───┘      └───┘       └───┘       └───┘                │
│                │           │           │                  │
│                ├─ A        ├─ A        ├─ A                │
│                ├─ B ✓      ├─ B ✓      ├─ B ✓              │
│                └─ C        └─ C        └─ C                │
├──────────────────────────────────────────────────────────┤
│  STEP 3 / 融合                                            │
│                                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ A          │ │ B ✓        │ │ C          │             │
│  │ ……         │ │ ……         │ │ ……         │             │
│  │ 新颖度 82  │  │ 新颖度 87  │  │ 新颖度 79  │             │
│  │ [选择]     │  │ [已选择]   │  │ [选择]     │             │
│  └────────────┘ └────────────┘ └────────────┘             │
│                                                          │
│  AI 为什么推荐「融合」？                                  │
│  当前创意需要外部冲突来推动剧情                            │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  创意质量   新颖度 87   冲突 91   故事潜力 88              │
│                                                          │
│                      [继续 →]                            │
└──────────────────────────────────────────────────────────┘
```

视觉规则（沿用 PRD §12）：

- 已选择分支：高亮
- 未选择分支：淡化色
- 历史分支：可点击查看历史
- 当前步骤：强调（最大视觉权重）
- 未生成步骤：未来占位（淡灰色）

### 7.4 Toolbar 简化

旧 Toolbar 显示「节点数 N / 活跃数 M」属于树编辑器思维，移除。

保留：

```text
Step 3 / 5

[查看完整路径]  [重新开始]
```

### 7.5 Commit 按钮启用条件（前端）

```typescript
function canCommit(canvas: CreativeCanvas): boolean {
  if (canvas.committed) return false;
  const path = canvas.creative_path;
  const completed = path.filter(p => p.state === "completed");
  const stale = path.filter(p => p.state === "stale");
  const locked = path.filter(p => p.state === "locked");
  // Step 5 必须 COMPLETED（v2.0 MVP 不支持早收束）
  const step5 = path.find(p => p.step === 5);
  if (!step5 || step5.state !== "completed") return false;
  if (stale.length > 0) return false;
  if (completed.length < 5) return false;
  if (!canvas.final_concept) return false;
  return true;
}
```

### 7.6 useCreativeCanvasV2 hook

```typescript
type CreativeCanvasState = {
  status: "empty" | "active" | "completed" | "committed" | "loading";
  canvas: CanvasV4 | null;
  currentStep: number;
  error: string | null;
  loadingStep: boolean;
};

type CreativeCanvasActions = {
  loadCanvas: () => Promise<void>;
  initSession: (rawIntent: RawIntent) => Promise<void>;
  nextStep: () => Promise<NextStepResponse>;
  selectOption: (step: number, optionId: string) => Promise<void>;
  commitCanvas: () => Promise<void>;
  resetCanvas: () => Promise<void>;
};

function useCreativeCanvasV2(projectId: string): [CreativeCanvasState, CreativeCanvasActions] {
  // ...
}
```

### 7.7 关键交互流

```
1. CanvasEmptyState → 用户输入 Idea
2. initSession → 写 canvas_state.json v4
3. loadCanvas → 渲染横向路径（IDEA + Step 1 AVAILABLE）
4. 用户点 Step 1 卡片 → nextStep 调用 → 3 选项渲染
5. 用户选 B → selectOption(B) → 后端自动 nextStep 生成 Step 2 → 渲染 Step 2 卡片
6. 重复 4-5 直到 Step 5
7. Step 5 选完后 → 后端生成 final_concept → 渲染 QualityBar + Commit 按钮
8. 用户点 Commit → commit 端点 → 写 concept_and_dna.json → 跳转 /stage0
```

---

## 8. 下游契约（v2.0 MVP）

### 8.1 concept_and_dna.json 输出（v2.0 不变 schema）

v2.0 commit 输出**完全保留 v3 schema**，**不写** v2 新增字段：

```json
{
  "concept": {
    "title": "",
    "premise": "",
    "genre": "",
    "tone": "",
    "theme": "",
    "target_audience": "",
    "style_template": "",
    "source": "canvas"
  },
  "story_dna": {
    "core_contradiction": { "statement": "", "side_a": "", "side_b": "" },
    "value_stack": [
      { "level": "personal", "value_a": "", "value_b": "" },
      { "level": "social", "value_a": "", "value_b": "" },
      { "level": "philosophical", "value_a": "", "value_b": "" },
      { "level": "existential", "value_a": "", "value_b": "" }
    ],
    "style_template": "",
    "fusion_meta": null
  },
  "canvas_snapshot": {
    "selected_path": [...],
    "committed_at": "..."
  }
}
```

### 8.2 canvas_snapshot.selected_path 双写策略

v2.0 commit 同时写：

```python
# 从 creative_path 派生 selected_path（保留 v3 兼容）
selected_path_v3 = []
for p in canvas["creative_path"]:
    if p["state"] == "completed":
        # 从 selected_option_id 推断（如 "opt_3_b" → "step3_option_b"）
        selected_path_v3.append(p["selected_option_id"])

concept_and_dna["canvas_snapshot"]["selected_path"] = selected_path_v3
```

目的：兼容 `scripts/backfill_creative_divergence.py:61` 等脚本读取 selected_path。

### 8.3 不写 v2 新增字段（v2.0 MVP 范围）

PRD §28.1 明确：**MVP 不写** `creative_path` / `creative_mechanism` / `canvas_meta` 三个 v2 新增字段到 concept_and_dna.json。

v2.1 才升级下游消费者（ConceptStep / World / Character / Map / Outline 读取 creative_path），同时 commit 输出加 v2 新字段。

下游消费者**不修改**：

- `frontend/src/components/wizard/ConceptStep.tsx`（读 `concept.{title, premise, tone, theme, target_audience, style_template, source}` + `story_dna.core_contradiction.{statement, side_a, side_b}`）
- `backend/api/stage1_concept.py`（读 concept_and_dna.json 整体）
- `backend/conductor/state_machine.py:38-39`（STAGE1→STAGE2 gate）
- `backend/api/stage2_world_char.py`（读 concept + story_dna 整体）
- `backend/api/stage4_writing.py`（读 concept 整体）

---

## 9. 实施步骤

### 9.1 阶段划分

| 阶段 | 内容 | 工时估计 |
|---|---|---|
| **S1: 后端 schema 与迁移** | `_migrate_v3_to_v4` + `_read_canvas` 入口改造 + `_write_canvas` write_through 参数 | 2 天 |
| **S2: 后端端点** | 新增 `/session/next-step` + 合并 `/session/select` + `/state` 改 v4 + `/commit` v3 兼容 | 3 天 |
| **S3: 后端 Step 状态机** | `transition_step_state` + `_validate_step_invariants` + `_validate_for_commit` | 1 天 |
| **S4: AI 选择 prompt 草稿落地** | `compute_op_hint` + 单次 LLM 调用 prompt + 失败处理 | 2 天 |
| **S5: 前端组件重写** | HorizontalPathCanvas + ActiveStepPanel + QualityBar + useCreativeCanvasV2 hook | 3 天 |
| **S6: 前端 API 客户端扩展** | nextStepCanvas / selectCanvasOption / commitCanvas | 1 天 |
| **S7: 集成测试** | 端到端流程：init → 5 步 select → 跳转 | 2 天 |
| **S8: 灰度发布** | feature flag + 老 canvas 路由保留 1 周 | 1 天 |
| **总计** | | **15 天** |

### 9.2 后端先行原则

**S1-S4 必须先完成并通过 backend 测试**，再开始 S5 前端改造。原因：

- v3 → v4 migration 是 silent 行为，bug 难复现
- Step 状态机的 transition rule 必须先用 backend 测试覆盖
- AI 选择 prompt 的失败处理需要在没有 UI 时也能跑通

### 9.3 灰度策略

使用 feature flag `ENABLE_CANVAS_V2`：

```python
# backend/main.py 或 settings.py
ENABLE_CANVAS_V2 = os.environ.get("ENABLE_CANVAS_V2", "false").lower() == "true"
```

```typescript
// frontend/src/pages/CreativeCanvasPage.tsx
const useV2 = process.env.REACT_APP_CANVAS_V2 === "true";

if (useV2) {
  return <CreativeCanvasPageV2 />;
} else {
  return <CreativeCanvasPageV1 />;  // 老 WhatIfTree
}
```

灰度流程：

1. **第 1 周**：自己 dogfood，所有 dev 走 v2
2. **第 2 周**：10% 用户走 v2（按 project_id hash）
3. **第 3 周**：50% 用户走 v2
4. **第 4 周**：100% 用户走 v2
5. **第 5 周**：删除 v1.x 路由 + CanvasPageV1

### 9.4 回滚方案

```python
# backend/api/creative_diverge.py
if settings.ENABLE_CANVAS_V2:
    from .v2_routes import router as v2_router
    app.include_router_router
    from .v1_routes import router as v1_router  # 旧路径
    app.include_router_router
else:
    from .v1_routes import router as v1_router
    app.include_router_router
```

关闭 `ENABLE_CANVAS_V2=false` 立即回到 v1.x。

注意：已通过 v2 创建的 `canvas_state.json` v4 在回滚后会通过 `_read_canvas` 的 lazy migration 兼容读取（v4 → v4 直接返回）。

---

## 10. 测试计划

### 10.1 单元测试

| 测试 | 覆盖点 | 文件 |
|---|---|---|
| `test_migrate_v3_to_v4` | v3 → v4 字段映射、空字段 fallback、idea_variants 处理 | `tests/test_creative_os/test_migration.py` |
| `test_transition_step_state` | 5 态所有合法 transition | `tests/test_creative_os/test_state_machine.py` |
| `test_compute_op_hint` | 6 个判定分支 + fallback | `tests/test_creative_os/test_op_hint.py` |
| `test_validate_for_commit` | 5 种 commit 失败场景 | `tests/test_commit_validation.py`（API 层测试，与 `tests/test_branch_api.py` 同级）|
| `test_next_step_prompt_format` | LLM 返回 JSON 解析 + 失败重试 | `tests/test_creative_os/test_prompt.py` |

### 10.2 集成测试

| 测试 | 覆盖点 |
|---|---|
| `test_init_session_writes_v4` | init 端点写 raw_intent + root_idea + creative_path[0] |
| `test_select_triggers_next_step` | select 端点自动触发 next-step |
| `test_select_step_5_triggers_final_concept` | Step 5 选完生成 final_concept |
| `test_commit_writes_v3_compat` | commit 端点输出 v3 schema + canvas_snapshot.selected_path 双写 |
| `test_read_canvas_lazy_migrates_v3` | v3 canvas 读时迁移到 v4 |
| `test_read_canvas_does_not_overwrite_committed_v3` | 已 commit v3 不被覆盖 |
| `test_reject_overwrite_committed_canvas` | 写端点对 committed canvas 返 409 |

### 10.3 E2E 测试（Playwright）

| 场景 | 步骤 |
|---|---|
| 完整 5 步 commit 流程 | init → 5 次 next-step → 5 次 select → commit → 跳转 /stage0 |
| 中途关闭浏览器再恢复 | 走到 Step 3 → 关闭 → 重开 → loadCanvas 恢复 → 继续 |
| STALE 步骤阻止 commit | 走完 5 步 → 手动改 canvas_state 制造 STALE → commit 应 422 |
| 概念 DNA 写入正确 | commit 后读 concept_and_dna.json，验证 schema 是 v3 |

### 10.4 兼容测试

| 测试 | 覆盖点 |
|---|---|
| `test_v1_project_canvas_state_readable` | 旧的 v3 canvas_state.json 在 v2 后端可读 |
| `test_v1_project_canvas_state_writable_via_reset` | 旧 v3 canvas 可通过 DELETE /state 重置为 v4 |
| `test_concept_and_dna_v3_consumer_works` | 现有 ConceptStep.tsx 在 v2 输出下行为一致 |

### 10.5 性能测试

| 测试 | 期望值 |
|---|---|
| next-step 端到端延迟 | P95 < 8s（单次 LLM 调用）|
| state 读端点延迟 | P95 < 200ms |
| commit 端点延迟 | P95 < 5s（含 final_concept LLM 生成）|

---

## 11. 风险与权衡

### 11.1 风险登记

| ID | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| R1 | v3 → v4 migration bug 导致 canvas_state 损坏 | 高 | 单元测试覆盖所有字段映射；migration 函数纯函数；migration 失败保留 v3 原文 |
| R2 | 单次 LLM 调用返回 JSON 解析失败率高 | 中 | 重试 1 次 + fallback 到通用 LLM prompt + 503 给前端 |
| R3 | compute_op_hint 规则过于粗糙，LLM 经常 override | 中 | v2.0 接受 LLM override；v2.1 增加规则覆盖度评估 |
| R4 | 5 步固定导致某些用户希望更多步骤 | 低 | UI 提示「5 是上限不是必须」（v2.1 启用早收束时改为「可以提前收束」）|
| R5 | 替换 WhatIfTree 导致长期 v1.x 用户不适应 | 中 | 灰度发布 + 老 canvas 路由保留 1 周 + UI 内 onboarding tooltip |
| R6 | 删除 v1.x 端点导致外部集成破裂 | 中 | 保留 `/init` / `/expand` / `/select` / `/commit` / `/state` / `/evaluate` 路径，标记 deprecated；v2.1 删除 |
| R7 | 未在 MVP 启用 v2 新增字段 → 下游 consumer 升级推迟 | 低 | 这正是 v2.0 MVP 的策略；v2.1 才升级 |

### 11.2 兼容性保证

**保证**：

- 旧的 `canvas_state.json` v3 在 v2 后端可读（lazy migration）
- 已 committed 的 v3 项目不会被 v2 migration 覆盖
- `concept_and_dna.json` 输出 schema 100% 与 v1.x 兼容
- `scripts/backfill_creative_divergence.py` 等脚本继续工作（canvas_snapshot.selected_path 仍写入）

**不保证**：

- v1.x 端点 100% 行为不变（部分合并到 /select）
- `evaluate` 端点行为不变（v2 改为 fire-and-forget）
- 概念 DNA 显示创意路径摘要（v2.0 不启用，等 v2.1）

### 11.3 回滚方案

详见 §9.4。

关闭 `ENABLE_CANVAS_V2=false`：

1. 所有新请求走 v1.x 路由
2. 已创建的 v4 canvas 在 v1.x 端点下不识别 → 用户需重置
3. 数据库无破坏（v1.x 写 v3 canvas，覆盖 v4）

**回滚限制**：

- v2.0 期间不能回滚（v4 canvas 已被写）
- v2.1+ 之后可以安全回滚（v1.x 端点标 deprecated 但仍可用）

---

## 12. v2.1+ 推迟项

本 spec 不实施，但需要在代码注释中标注 `// v2.1+`：

| 功能 | PRD 位置 | 备注 |
|---|---|---|
| 早收束 | §36 | 需新增 SKIPPED 状态 |
| 用户主动 override AI 推荐 | §38 | 需新增 `override_operation` 参数 |
| 分支回溯 | §37 | 需新增 STALE → AVAILABLE 转移 |
| Regenerate | §39 | 需新增 `/regenerate` 端点 + similarity 检查 |
| concept_and_dna.json 写 v2 新增字段 | §20 | 需同步升级下游消费者 |
| ConceptStep 注入 creative_path 摘要 | §20.3 | 需修改前端 |
| World / Character / Map / Outline 注入 creative_path | §20.3 | 需修改 Stage 2/3 端点 |

---

## 附录 A: 端点差异对照表

| v1.x 端点 | v2.0 端点 | 行为变化 |
|---|---|---|
| `POST /init` | `POST /session/init` | 双写 raw_intent + root_idea；返回 session_id |
| `POST /expand` | `POST /session/next-step` | **重大变更**：从树展开变为单步 3 选项；不再返回 nodes 增量 |
| `POST /apply-mutation` | **删除** | 折入 next-step 的 operation 选择 |
| `POST /choose-branch` | `POST /session/select` | 合并到 select；单端点处理 option_id 选择 |
| `POST /select` | `POST /session/select` | 同上 |
| `POST /evaluate` | `POST /session/evaluate`（deprecated）| 后端改为 fire-and-forget |
| `GET /state` | `GET /session/state` | 输出 v4 schema（lazy migrate）|
| `DELETE /state` | `DELETE /session/state` | 行为不变 |
| `POST /commit` | `POST /session/commit` | 输出 v3 schema 兼容 |
| `GET /novelty` | **删除** | 折入 next-step options[].scores |
| `POST /fuse` | **删除** | 折入 next-step 的 operation=fuse 分支 |
| `POST /contradict` | **删除** | 折入 next-step 的 operation=break/invert 分支 |
| 无 | `POST /session/regenerate` | v2.1 启用 |
| 无 | `POST /session/backtrack` | v2.1 启用 |
| 无 | `POST /session/finalize` | v2.1 启用 |

---

## 附录 B: 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 单次 LLM vs 两次 LLM | **单次** | 减少 50% 延迟 |
| backend 计算 op_hint vs LLM 自选 | **backend hint + LLM 可微调** | 让 LLM 不依赖语感，保证 deterministic fallback |
| Step 5 是否必须 COMPLETED 才能 commit | **是**（v2.0）| MVP 砍掉早收束；v2.1 启用 SKIPPED 后放宽 |
| 是否保留 v3 raw_intent | **是** | 前端 InitRequest 已绑定；删除导致 422 |
| 是否写 creative_path 到 concept_and_dna.json | **否**（v2.0）| MVP 不写新字段；v2.1 + 下游升级后启用 |
| 是否保留 canvas_snapshot.selected_path | **是**（双写）| 兼容 backfill 脚本；v2.1 评估移除 |
| commit 校验在后端 vs 前端 | **两端都校验** | 前端 UX；后端 server 是 source of truth |

---

## 附录 C: 文件级变更总览

### 后端

| 文件 | 变更类型 | 行数估计 |
|---|---|---|
| `backend/api/creative_diverge.py` | 大改 | +300 / -200 |
| `backend/api/v2_routes.py`（新增）| 新增 | ~250 |
| `backend/creative_os/state_machine.py` | 新增 | ~80 |
| `backend/creative_os/op_hint.py` | 新增 | ~50 |
| `backend/prompts/canvas_v2_next_step.yaml` | 新增 | ~40 |
| `tests/test_creative_os/test_migration.py` | 新增 | ~150 |
| `tests/test_creative_os/test_state_machine.py` | 新增 | ~100 |
| `tests/test_creative_os/test_op_hint.py` | 新增 | ~50 |
| `tests/test_commit_validation.py` | 新增 | ~80 |

### 前端

| 文件 | 变更类型 | 行数估计 |
|---|---|---|
| `frontend/src/pages/CreativeCanvasPage.tsx` | 重写 | ~150 |
| `frontend/src/components/creative-canvas/HorizontalPathCanvas.tsx` | 新增 | ~200 |
| `frontend/src/components/creative-canvas/ActiveStepPanel.tsx` | 新增 | ~150 |
| `frontend/src/components/creative-canvas/QualityBar.tsx` | 新增 | ~50 |
| `frontend/src/components/creative-canvas/CanvasToolbar.tsx` | 重写 | ~80 |
| `frontend/src/hooks/useCreativeCanvasV2.ts` | 新增 | ~200 |
| `frontend/src/api/client.ts` | 扩展 | +100 |
| `frontend/src/components/creative-canvas/WhatIfTree.tsx` | **删除** | -300 |
| `frontend/src/components/creative-canvas/CanvasNode.tsx` | **删除** | -100 |
| `frontend/src/components/creative-canvas/NodeDetailPanel.tsx` | **删除** | -200 |
| `frontend/tests/components/creative-canvas/*.test.tsx` | 新增 | ~300 |

### 文档

| 文件 | 变更类型 |
|---|---|
| `docs/design/creative-canvas-reconstruction.md` | 已完成 |
| `docs/superpowers/specs/2026-09-02-creative-canvas-v2-design.md` | 本 spec |
| `docs/superpowers/plans/2026-09-02-creative-canvas-v2.md` | 下一步：写实施 plan |