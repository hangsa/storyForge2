# Phase 3b: Rollback System (ImpactAnalyzer + Rollback API) — 设计方案

> 日期: 2026-06-15 | 状态: 已确认 | 依赖: Phase 0-2

## 范围

v1.6 TRD Phase 3，回退系统部分（Steps 3.1 + 3.2），约 11h。

### 本轮实现

- ImpactAnalyzer：零 LLM，基于文件 SHA256 hash 对比 + 按文件类型分级
- Baseline manifest：首次进入 STAGE 4 时自动建立，存储在 `baseline_manifest.json`
- 2 个新增 API 端点（放在 `backend/api/conductor.py`）

### 本轮不实现

- SF_LOG 扫描检测叙事资产引用冲突（依赖 StoryOS Agent 完整实现）
- 自动文件回退（cancel 仅提示，不自动恢复文件）
- 前端 ImpactReportPanel（Phase 5）

---

## 1. 架构

```
STAGE 2 用户修改设定
        │
        ▼
POST /api/conductor/analyze-impact
  {project_id, modified_files: ["characters.json"]}
        │
        ▼
ImpactAnalyzer.analyze()
  ├── _load_baseline()          ← 读取 baseline_manifest.json
  ├── _compute_current_hash()   ← SHA256 当前文件
  ├── _compare_hashes()         ← 对比差异
  └── _classify()               ← 按文件类型分级
        │
  story_dna.json 变更 → P0 entries (全局影响，全部章复核)
  characters.json 变更 → P1 entries (涉及角色的场景复核)
  world.json 变更 → P1 entries (涉及世界规则的场景复核)
  outline.json 新增章 → P2 (仅影响未来)
  outline.json 删除/重排 → P1 (已有章可能受影响)
        │
        ▼
  返回 ImpactReport → 前端展示
        │
        ▼
POST /api/conductor/execute-rollback
  {project_id, action: "confirm"|"cancel"}
  confirm → 更新 baseline_manifest（接受变更）
  cancel  → 提示用户手动恢复文件
```

---

## 2. 分级规则

| 修改文件 | 变更类型 | 级别 | 原因 |
|----------|----------|------|------|
| `story_dna.json` | 任何变更 | P0 | 全局影响，全部已完成章需重新审视 |
| `world.json` | 任何变更 | P1 | 世界规则变更可能影响场景中的能力使用 |
| `characters.json` | 任何变更 | P1 | 角色设定变更可能影响已完成场景中的行为一致性 |
| `outline.json` | 基线章号有缺失或顺序变化 | P1 | 已完成章的大纲可能已过时 |
| `outline.json` | 仅新增章节（当前章号 ⊇ 基线章号） | P2 | 不影响已完成内容 |

outline.json 对比需同时解析新旧 JSON 内容，提取 `chapters[].chapter_number` 列表：
- 当前章号集合包含基线全部章号 → 纯新增 → P2
- 基线章号有缺失 或 顺序不同 → 删除/重排 → P1

---

## 3. 数据模型

### ImpactEntry / ImpactReport (backend/conductor/impact_analyzer.py)

```python
from enum import Enum
from dataclasses import dataclass, field

class ImpactPriority(str, Enum):
    P0_MUST_REWRITE = "P0"
    P1_SUGGEST_REVIEW = "P1"
    P2_NO_IMPACT = "P2"

@dataclass
class ImpactEntry:
    chapter_number: int          # 受影响的章号（P0=0 表示全部章）
    scene_numbers: list[int]     # 受影响的场景号（当前为空列表，预留）
    priority: ImpactPriority
    reason: str                  # 人类可读中文原因
    affected_assets: list[str]   # 受影响文件

@dataclass
class ImpactReport:
    project_id: str
    modified_files: list[str]
    entries: list[ImpactEntry]
    summary: dict[str, int]      # {"P0": n, "P1": n, "P2": n}
```

### Baseline manifest (projects/{id}/baseline_manifest.json)

```json
{
  "story_dna.json": "abc123...",
  "world.json": "def456...",
  "characters.json": "ghi789...",
  "outline.json": "jkl012..."
}
```

---

## 4. API 设计

端点放在新建文件 `backend/api/conductor.py`，router prefix = `/api/conductor`。

### POST /api/conductor/analyze-impact

```
Request:  { project_id: string, modified_files?: string[] }
         modified_files 可选；不传则自动检测所有 4 个文件

Response 200:
{
  "error": false,
  "detail": {
    "project_id": "...",
    "modified_files": ["world.json"],
    "entries": [
      {
        "chapter_number": 0,
        "scene_numbers": [],
        "priority": "P1",
        "reason": "world.json 已变更，世界规则修改可能影响所有已完成场景中的能力使用",
        "affected_assets": ["world.json"]
      }
    ],
    "summary": {"P0": 0, "P1": 1, "P2": 0}
  }
}

Response 400: BASELINE_NOT_FOUND — 尚未建立基线（未进入过 STAGE 4）
Response 400: NO_CHANGES_DETECTED — 所有文件 hash 与基线一致
```

### POST /api/conductor/execute-rollback

```
Request:  { project_id: string, action: "confirm" | "cancel" }

confirm → 200: { error: false, detail: { status: "confirmed", baseline_updated: true, message: "基线已更新" } }
          更新 baseline_manifest.json 为当前文件 hash

cancel  → 200: { error: false, detail: { status: "cancelled", message: "请手动恢复文件..." } }
          不修改任何文件，仅返回提示

Invalid action → 400: INVALID_ACTION
```

---

## 5. 基线建立触发

在 STAGE 4 首次进入时自动建立。检测方式：`baseline_manifest.json` 不存在 → 创建。

触发位置：`GET /api/stage4/progress` 端点中调用 `ensure_baseline(project_id)`（幂等，文件存在即跳过）。只在加载 STAGE 4 页面时调用一次。

---

## 6. 错误处理与降级

| 场景 | 行为 |
|------|------|
| 基线文件不存在 | `analyze-impact` 返回 400 BASELINE_NOT_FOUND |
| 文件 hash 无变化 | `analyze-impact` 返回 400 NO_CHANGES_DETECTED |
| 项目目录不存在 | `analyze-impact` 返回 404 PROJECT_NOT_FOUND |
| Hash 计算失败（文件损坏） | 跳过该文件，日志警告 |
| `execute-rollback` cancel | 不需要基线即可执行，仅返回提示信息 |

---

## 7. 文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `backend/conductor/impact_analyzer.py` | **新增** | ImpactAnalyzer + ImpactEntry/ImpactReport/ImpactPriority |
| 2 | `backend/api/conductor.py` | **新增** | analyze-impact + execute-rollback 端点 |
| 3 | `backend/main.py` | 修改 | 注册 conductor router |
| 4 | `tests/test_impact_analyzer.py` | **新增** | 分级准确性、hash 对比、API 端点 |

---

## 8. 验收标准

1. `POST /api/conductor/analyze-impact` 返回正确的 P0/P1/P2 分级
2. `story_dna.json` 变更 → P0，`world.json`/`characters.json` 变更 → P1
3. `outline.json` 新增章 → P2，删除/重排章 → P1
4. `POST /api/conductor/execute-rollback` confirm 更新基线，cancel 返回提示
5. 基线不存在时 analyze-impact 返回 400
6. 零 LLM 调用，所有逻辑确定性
7. 无文件变更时返回 NO_CHANGES_DETECTED
