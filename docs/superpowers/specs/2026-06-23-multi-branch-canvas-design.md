# Creative Canvas 多分叉路径改造 — 设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把创意画布从「单路径 + 4 维度 facets」重构为「多分叉路径 + 互斥选择 + 可反悔」模型，使用户能沿单一 root→leaf 路径探索 3^N 种剧情走向。

**Architecture:** 数据层在每个 WhatIfNode 上加 `branch_status: "active" | "dimmed"`，并在 `canvas_state.json` 顶层加 `branch_choices: {parent_id: chosen_child_id}` 映射；引擎层把 `expand_node` 改为生成 3 条互斥路径；前端按 `branch_status` 灰化未选分支并阻止其展开；新增 `POST /choose-branch` 端点处理反悔；`schema_version` 字段驱动 v1→v2 一次性迁移。

**Tech Stack:** Python 3.9 + FastAPI + Pydantic dataclass + pytest-asyncio；React 18 + TypeScript + @xyflow/react v12 + vitest + React Testing Library。

---

## 1. 决策摘要（5 个关键决定 + 1 个数据模型选择）

| 决策 | 选择 | 理由 |
|---|---|---|
| 每节点分支数 | **3** | 经典三选一；3^N 满树 40 节点，可读性好；每分支 LLM token 配额高 |
| 未选分支处理 | **保留并灰化** | 保留创作思路可追溯；用户可点击查看内容但不能向下展开 |
| 4 维度（角色动机/世界观规则/情节方向/读者体验） | **彻底移除** | 与「互斥路径」语义冲突；节点不再有维度标签 |
| 反悔 | **支持** | 灰节点可重新激活，原 active 自动变 dimmed；children 保留 |
| 评分 | **聚焦已选路径** | NoveltyRadar 只对 active 路径上的节点显示；路径评估自动重算 |
| 数据模型 | **节点级 `branch_status`** | UI 渲染最直接；可扩展（未来「导出整个画布」） |

## 2. 数据模型

### 2.1 `WhatIfNode` dataclass 改动（`backend/models/creative_os.py`）

```python
from dataclasses import dataclass, field
from typing import Optional

BRANCH_STATUS_ACTIVE = "active"
BRANCH_STATUS_DIMMED = "dimmed"
BRANCH_STATUSES = {BRANCH_STATUS_ACTIVE, BRANCH_STATUS_DIMMED}

@dataclass
class WhatIfNode:
    id: str
    depth: int
    parent_id: Optional[str]
    content: str
    novelty_score: float = 0.0
    trope_tags: list[str] = field(default_factory=list)
    saturation_warning: Optional[str] = None
    children_ids: list[str] = field(default_factory=list)
    is_expanded: bool = False
    branch_status: str = BRANCH_STATUS_ACTIVE   # NEW
    # dimension 字段彻底移除
```

### 2.2 `canvas_state.json` schema v2

```json
{
  "schema_version": 2,
  "root_node_id": "wi_001_00",
  "nodes": {
    "wi_001_00": {
      "id": "wi_001_00",
      "depth": 0,
      "parent_id": null,
      "content": "故事前提",
      "novelty_score": 0.0,
      "trope_tags": [],
      "saturation_warning": null,
      "children_ids": ["wi_001_01", "wi_001_02", "wi_001_03"],
      "is_expanded": true,
      "branch_status": "active"
    },
    "wi_001_01": { "...branch_status": "active..." },
    "wi_001_02": { "...branch_status": "dimmed..." },
    "wi_001_03": { "...branch_status": "dimmed..." }
  },
  "edges": [["wi_001_00", "wi_001_01"], ...],
  "selected_path": ["wi_001_00", "wi_001_01"],
  "branch_choices": {
    "wi_001_00": "wi_001_01"
  },
  "evaluations": { ... },  // 不变
  "created_at": "2026-06-23T...",
  "updated_at": "2026-06-23T..."
}
```

### 2.3 不变量（`_validate_canvas_invariants()` 校验）

1. **每个有 `children_ids` 且至少一个 child 已生成的节点，在 `branch_choices` 中必须有一个值**（active child id）；root 节点若 `is_expanded=true` 必须在 `branch_choices` 中。
2. **`selected_path` 必须是合法单链**：从 `root_node_id` 开始，每个节点（除最后一个）的 `children_ids` 必须包含下一个节点。
3. **`selected_path` 上的所有节点必须 `branch_status="active"`**。
4. **`branch_choices` 的 value 必须指向 `parent.children_ids` 中的一个节点**。
5. **dimmed 节点可以有 `children_ids`（已展开过），但它们的 children 也必须是 dimmed**（一个节点的 children 状态必须随父节点：父 active → 子中 1 active + 2 dimmed；父 dimmed → 全 dimmed）。
6. **root 节点必须 `branch_status="active"`**（不可 dimmed）。

校验失败时写入前抛 `CanvasInvariantError`，由 API 转为 500。

## 3. 引擎变更（`backend/creative_os/whatif_engine.py`）

### 3.1 类常量

```python
class WhatIfEngine:
    MAX_DEPTH = 3
    BRANCHES_PER_NODE = 3   # RENAMED from BREADTH
    # BREADTH 保留为 alias 以避免破坏现存测试代码
    BREADTH = 3
```

### 3.2 `expand_node()` prompt 改写

**旧 system prompt**（片段）：
> "从4个叙事维度各生成一个分支可能..."

**新 system prompt**（核心）：
> "你是一位资深的创意故事构思师，擅长从叙事前提中生发散性分支。你的任务是：给定一个故事前提/创意节点，生成 3 条**互斥的剧情走向**。三条路径必须代表截然不同的故事方向..."

**新 user prompt** 模板：
```
当前前提：{node.content}
当前深度：第{node.depth}层
{ancestor_contents ? "祖先路径（从根到当前）：\n{chain}\n" : ""}
请生成 3 条互斥的剧情走向选项，输出JSON数组格式：
[{"content": "走向内容（50-150字）", "novelty_score": 75, "trope_tags": ["标签1", "标签2"]}]
```

**字段变更**：LLM 不再被要求输出 `dimension` 字段；如果 LLM 误输出，后端忽略。

### 3.3 `expand_node()` 返回值

返回 3 个 `WhatIfNode`，全部 `branch_status="active"`，没有 `dimension` 字段。生成后父节点 `is_expanded=True`，`children_ids` 含 3 个 id。

## 4. API 契约

### 4.1 新增 `POST /api/v1/projects/{project_id}/creative/canvas/choose-branch`

**请求**：
```json
{ "parent_node_id": "wi_001_00", "chosen_child_id": "wi_001_02" }
```

**行为**（服务端）：
1. 校验 `parent_node_id` 和 `chosen_child_id` 都存在（否则 404）
2. 校验 `chosen_child_id` 在 `parent.children_ids` 中（否则 400 `INVALID_CHILD`）
3. 校验 `parent.is_expanded=True`（否则 400 `PARENT_NOT_EXPANDED`）
4. 更新 `branch_choices[parent_node_id] = chosen_child_id`
5. 把 `chosen_child_id` 节点设为 `branch_status="active"`
6. 把 `parent` 的其他 children 设为 `branch_status="dimmed"`（包括之前 active 的那个）
7. **级联 dimmed**：从 `chosen_child_id` 沿 `children_ids` 向下，把所有后代节点的兄弟也设 dimmed（确保不变量 5 成立）
8. 清除 `chosen_child_id` 之下、原来 `branch_choices` 中**指向被 dimmed 兄弟**的条目（递归剪枝）
9. 重新计算 `selected_path` 通过 `_compute_selected_path(nodes, branch_choices, root_node_id)`
10. 写回 `canvas_state.json`
11. 调用 `_validate_canvas_invariants()` 兜底

**响应**：
```json
{
  "error": false,
  "code": "OK",
  "message": "",
  "detail": {
    "selected_path": ["wi_001_00", "wi_001_02"],
    "branch_choices": { "wi_001_00": "wi_001_02" },
    "chosen_node": { ...WhatIfNode dict... },
    "dimmed_count": 2
  }
}
```

**错误码**：
| 场景 | HTTP | code |
|---|---|---|
| parent 或 child 不存在 | 404 | `NODE_NOT_FOUND` |
| child 不在 parent.children_ids 中 | 400 | `INVALID_CHILD` |
| parent 未展开 | 400 | `PARENT_NOT_EXPANDED` |
| 画布未初始化 | 400 | `CANVAS_NOT_INITIALIZED` |
| 项目不存在 | 404 | `PROJECT_NOT_FOUND` |

### 4.2 端点变更表

| 端点 | 行为变更 |
|---|---|
| `GET /state` | 不变（透明读出 v2 schema） |
| `POST /init` | 生成的 root `branch_status="active"`，无 `dimension` 字段；初始化 `branch_choices={}`、`schema_version=2` |
| `POST /expand` | 调用 `WhatIfEngine.expand_node()` 新版本；返回的 children 都 `active`；不读不写 `dimension`；**校验请求节点 `branch_status="active"`**，否则 400 `DIMMED_NODE_CANNOT_EXPAND` |
| `POST /choose-branch` | **新增**，见 4.1 |
| `POST /select` | 改为**只接受 active 单链**；校验路径上每个节点 `branch_status="active"`；否则 400 `DIMMED_NODE_IN_PATH` |
| `POST /evaluate` | 不变；UI 自行决定是否展示给 dimmed 节点 |
| `POST /mutate` | 不变（占位） |
| `POST /merge` | 不变（占位） |
| `DELETE /state` | 不变 |

### 4.3 辅助函数

```python
def _compute_selected_path(nodes, branch_choices, root_node_id) -> list[str]:
    """Walk branch_choices from root, return linear chain."""
    path = [root_node_id]
    cursor = root_node_id
    while cursor in branch_choices:
        nxt = branch_choices[cursor]
        if nxt not in nodes.get(cursor, {}).get("children_ids", []):
            break  # invariant violated; defensive
        path.append(nxt)
        cursor = nxt
    return path

def _validate_canvas_invariants(canvas: dict) -> None:
    """Raise CanvasInvariantError if any of the 6 invariants fails."""
    ...

def _migrate_v1_to_v2(canvas: dict) -> dict:
    """One-time migration; idempotent."""
    ...
```

### 4.4 `_write_canvas` 改造

读取现有 canvas 时检查 `schema_version`：
- 缺失 → 视为 v1，调 `_migrate_v1_to_v2` 后再返回
- = 2 → 直接返回
- 其它 → 抛错

写入前必须过 `_validate_canvas_invariants()`。

## 5. 前端改造

### 5.1 类型变更（`frontend/src/types/canvas.ts`）

```ts
export type BranchStatus = "active" | "dimmed";

export interface WhatIfNode {
  id: string;
  depth: number;
  parent_id: string | null;
  content: string;
  novelty_score: number;
  trope_tags: string[];
  saturation_warning: string | null;
  children_ids: string[];
  is_expanded: boolean;
  branch_status: BranchStatus;
  // dimension 移除
}
```

### 5.2 `WhatIfTree` 渲染规则

**视觉**：
- active 节点：`bg-surface-container-low` border, text-primary, hover highlight
- dimmed 节点：`opacity-40`, `bg-surface-container/30`, `border-outline-variant/30`, cursor-default

**交互**：
| 操作 | active | dimmed |
|---|---|---|
| 单击 | 选中 + 打开 NodeDetailPanel | 同左（只读） |
| 双击 | 触发 `expandNode(id)` | **不响应**（事件被阻止） |
| 拖动 | 保留位置 | 保留位置 |
| 上下文菜单 | 展开 / 评分 / 变异 | **选择为分支**（调 `chooseBranch`） |

**布局**（`_buildLayout`）：
- 默认只渲染 active 节点的 children，dimmed 节点的 children **不渲染**
- 工具栏开关「显示 dimmed 子树」开启时：dimmed 节点的 children 也渲染，颜色更深灰（opacity-20）

### 5.3 `NodeDetailPanel` 改动

- **删除**「维度」卡片（原 `node.dimension` 引用）
- 「深度」卡片保留（显示 `L{node.depth}`）
- **新增**「路径状态」卡片：
  - active 节点显示「激活 ✓」
  - dimmed 节点显示「未选」+ 按钮「**选择为分支**」（点击调 `chooseBranch(parent_id, this_id)`）
- **新颖度评分卡片**：
  - 仅当 `selectedPath.includes(node.id)` 时渲染
  - dimmed 节点不显示评分（即使 API 已评分）

### 5.4 画布工具栏新增（`CanvasToolbar`）

- 计数器：「节点 {total} / 激活 {activeCount}」
- 开关：「显示 dimmed 子树」（默认关）
- 原有按钮（适应视图、重置画布）保留

### 5.5 `CreativeCanvasPage` 行为

- 当 `selectedPath` 变化时，**自动**触发 `POST /select`（无 debounce，每次变化都调；后端幂等；只用于触发 CreativeDirector 评估 + 持久化 evaluation，**不**强制覆盖客户端已显示的 selected_path）
- 路径评估文本显示在画布顶部状态条
- 不再有「dimmed 节点的评分卡污染总分」问题（因为雷达图不显示）
- `selectedPath` 变化来源：用户调用 `chooseBranch`、或 `/init`/`/expand` 后端响应附带新 selected_path

### 5.6 API client 新增（`frontend/src/api/client.ts`）

```ts
async function chooseBranch(
  projectId: string,
  parentNodeId: string,
  chosenChildId: string,
): Promise<{ selected_path: string[]; ... }> {
  return post(`/api/v1/projects/${projectId}/creative/canvas/choose-branch`, {
    parent_node_id: parentNodeId,
    chosen_child_id: chosenChildId,
  });
}
```

### 5.7 `useCreativeCanvas` hook 新增

```ts
interface UseCreativeCanvasReturn {
  // ...existing
  chooseBranch: (parentId: string, chosenChildId: string) => Promise<void>;
}
```

实现细节：
- 调 `api.chooseBranch`
- 用响应更新 `nodes` 中相关节点的 `branch_status` 和 `selected_path`
- 更新 `branchChoices` state（新字段）
- 失败时通过 `state.error` 暴露

## 6. 迁移策略

### 6.1 v1 → v2 迁移函数（`_migrate_v1_to_v2`）

输入 v1 canvas dict，输出 v2 canvas dict：

1. **保留** `created_at`、`updated_at`、`edges`、`evaluations` 字段（透传）
2. **删除每个节点的 `dimension` 字段**（如果存在）
3. **每个节点加 `branch_status="active"`**（v1 没有这个概念，全部视为激活，因为 v1 语义是 facets 不是分支）
4. **重建 `branch_choices`**：
   - 取 `selected_path` 中相邻对 `(parent, child)`，填入 `branch_choices[parent] = child`
   - 若 `selected_path` 不构成单链（v1 可能有多 facets 路径），取最长合法前缀
   - 若 `selected_path` 为空或 root 唯一，`branch_choices={}`
5. **写 `schema_version=2`**
6. **`_validate_canvas_invariants()` 兜底**；若失败抛错并保留原始文件

### 6.2 迁移触发

- `_read_canvas()` 内部检测 `schema_version`，缺失则调迁移
- 迁移是**幂等**的（v2 canvas 再跑迁移不重复执行）
- 迁移失败抛错并保留原始文件（先读再写，原子替换）

## 7. 测试

### 7.1 后端测试

**`tests/test_creative_canvas_choose_branch.py`**（新增，6 测试）：
- `test_choose_branch_switches_active_path`
- `test_choose_branch_on_dimmed_node_activates_and_dims_previous`
- `test_choose_branch_validates_parent_child_relationship`
- `test_choose_branch_validates_child_belongs_to_parent`
- `test_choose_branch_recomputes_selected_path`
- `test_choose_branch_clears_descendant_branch_choices_below_new_active`

**`tests/test_creative_canvas_select_persistence.py`**（扩充，2 测试）：
- `test_select_rejects_path_through_dimmed_node`（400 + code=`DIMMED_NODE_IN_PATH`）
- `test_select_accepts_active_path`（已存在基础上加 active 校验）

**`tests/test_creative_os/test_whatif_multi_branch.py`**（新增，3 测试）：
- `test_expand_node_returns_3_children_not_4`
- `test_expand_node_all_children_start_active`
- `test_expand_node_prompt_no_longer_mentions_4_dimensions`

**`tests/test_creative_canvas_migration.py`**（新增，3 测试）：
- `test_v1_canvas_with_4_facets_migrates_to_v2_with_active_status`
- `test_v1_canvas_with_branching_selected_path_gets_truncated`
- `test_v2_canvas_round_trips_no_migration`

**`tests/test_creative_canvas_invariants.py`**（新增，6 测试 — 每个不变量 1 个）：
- `test_invariant_1_branch_choices_for_expanded_nodes`
- `test_invariant_2_selected_path_is_linear_chain`
- `test_invariant_3_selected_path_nodes_are_all_active`
- `test_invariant_4_branch_choices_point_to_real_children`
- `test_invariant_5_dimmed_node_children_all_dimmed`
- `test_invariant_6_root_is_active`

### 7.2 前端测试

**`frontend/src/test/creative-canvas/useCreativeCanvas.test.ts`**（扩充）：
- `chooseBranch` 调 API + 更新本地 state

**`frontend/src/test/creative-canvas/WhatIfTree.test.tsx`**（新增）：
- dimmed 节点不响应双击
- active 节点双击触发展开
- dimmed 节点 opacity-40 class

**`frontend/src/test/creative-canvas/NodeDetailPanel.test.tsx`**（新增）：
- 不渲染「维度」卡片
- dimmed 节点显示「选择为分支」按钮
- 评分卡仅对 active 路径节点显示

## 8. 改动文件清单

| 文件 | 类型 |
|---|---|
| `backend/models/creative_os.py` | 改 WhatIfNode + 加 BRANCH_STATUS 常量 |
| `backend/creative_os/whatif_engine.py` | 改 expand_node prompt + BRANCHES_PER_NODE |
| `backend/api/creative_canvas.py` | 加 /choose-branch + 迁移 + 校验 + select 校验 |
| `frontend/src/api/client.ts` | 加 chooseBranch |
| `frontend/src/types/canvas.ts` | 改 WhatIfNode 类型 |
| `frontend/src/hooks/useCreativeCanvas.ts` | 加 chooseBranch action + branchStatus 字段 |
| `frontend/src/components/creative-canvas/WhatIfTree.tsx` | dimmed 渲染 + 阻止双击 + 默认不渲染 dimmed children |
| `frontend/src/components/creative-canvas/NodeDetailPanel.tsx` | 删维度卡片 + 加路径状态卡 + 评分卡条件渲染 |
| `frontend/src/components/creative-canvas/CanvasToolbar.tsx` | 加节点计数器 + dimmed 显示开关 |
| `frontend/src/pages/CreativeCanvasPage.tsx` | selected_path 自动 evaluate 触发 + 路径评估顶部状态条 |
| `tests/test_creative_canvas_choose_branch.py` | 新建（6 测试） |
| `tests/test_creative_canvas_select_persistence.py` | 扩充（2 测试） |
| `tests/test_creative_os/test_whatif_multi_branch.py` | 新建（3 测试） |
| `tests/test_creative_canvas_migration.py` | 新建（3 测试） |
| `tests/test_creative_canvas_invariants.py` | 新建（6 测试） |
| `frontend/src/test/creative-canvas/WhatIfTree.test.tsx` | 新建 |
| `frontend/src/test/creative-canvas/NodeDetailPanel.test.tsx` | 新建 |
| `frontend/src/test/creative-canvas/useCreativeCanvas.test.ts` | 扩充 |

## 9. Out of Scope

明确不做：
- ❌ 多根节点（root_node_id 仍单值）
- ❌ 跨用户协作 / canvas 分享
- ❌ 自动 A/B 测试（让 LLM 选最优分支）
- ❌ 把 dimmed 节点导出为「备份剧本」
- ❌ 与 Stage 2 世界观/角色生成自动桥接（独立 spec）
- ❌ 反悔时给出「diff 对比」（v2 不做）

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| v1 数据丢失 | 迁移函数保留所有节点；只在 metadata 层加字段 |
| `branch_choices` 与 `selected_path` 不一致 | 写入前过 `_validate_canvas_invariants()` 兜底 |
| 反悔后子节点链错乱 | `choose-branch` 服务端级联清理 `branch_choices` |
| dimmed 节点占用画布空间 | 默认不渲染 dimmed children；提供切换开关 |
| NoveltyEvaluator 仍按 4 维度评分 | 不动 evaluator，但 UI 仅对 active 路径显示雷达图 |
| LLM 在新 prompt 下仍输出 4 个 children | 后端截取前 3；记录 warning 日志 |
| 前端 dimmed 节点的 children 默认不渲染，用户找不到内容 | 工具栏开关可显示；hover dimmed 节点显示 tooltip 提示「点击查看详情」 |
| 反悔时 dimmed 节点已经被展开但子节点也是 dimmed，UI 显示「未展开」图标 | 在 dimmed 节点的 is_expanded=true 时显示「已展开（未选）」状态标识 |

---

**End of design doc.** 接下来请人工 review，确认后进入 plan 阶段。

---

## Implementation Progress

**Approved:** 2026-06-23
**Implementation started:** 2026-06-23 via subagent-driven-development
**Paused at:** Task 3 (user-requested checkpoint)

**Completed so far:**
- Task 1: `WhatIfNode` model — `dimension` dropped, `branch_status` + 3 constants added
- Task 2: API serializers `_node_to_dict` / `_dict_to_node` updated; uses `BRANCH_STATUS_ACTIVE` constant
- Task 3: `WhatIfEngine.expand_node()` now generates 3 mutually-exclusive branches; prompt rewritten to remove all dimension references; `test_whatif_path_context.py` fixtures cleaned

**Known issues carried forward:**
- `tests/test_creative_canvas_api.py::test_init_canvas` — mock asserts on removed `dimension` field (Task 8 cleanup target)
- `tests/test_creative_os/test_whatif_engine.py` — 3 stale assertions (BREADTH=4, dimension in {...}, len(children)=4) (immediate next cleanup step)

**Branch state:** `v1.7`, working tree clean, 3 commits ahead of last push.