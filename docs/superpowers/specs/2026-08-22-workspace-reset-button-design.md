# Workspace 初始化按钮设计（v2.1）

**状态**: Draft
**日期**: 2026-08-22
**作者**: brainstorm session

## 背景与目标

工作台（Workspace）的左侧栏 `<ChapterTreePanel />` 当前在右上角只有"刷新"按钮（data-testid="refresh"）和 manual 模式下的"+ 新章节"按钮。当用户已经推进到 STAGE4+、写了几章内容后，想要**从头重新做章节大纲**时，目前唯一路径是手动删除 `projects/{id}/` 下大量文件后再访问 wizard —— 既繁琐又危险。

需求：在"刷新"按钮**之前**新增"初始化"按钮。点击后：
1. 清空所有章节场景文稿（`chapters/*.md`）+ 运行时状态（`progress.json`、`.storyforge_checkpoint.json`、`autopilot/chunks/`）
2. 把 `project.json` 的 `current_stage` 写回 `INIT`
3. 跳转到 `/project/:id/wizard` —— wizard 以 `resume=true` 打开，自动 hydrate 已存在的 concept/world/character/novel_outline/outline.json 内容，用户最终停留在 step 6 章节大纲
4. manual 和 managed 两种模式都加此按钮

## 用户场景

### 主流程：用户想重新做章节大纲

1. 用户在 workspace 看到左侧栏有 20 章草稿
2. 用户对当前章节大纲不满意，想重新规划
3. 点击"初始化" → 弹窗显示"将删除 20 个章节草稿、写作进度、检查点，并将项目状态重置为初始化。此操作不可恢复。"
4. 用户确认 → 后端原子地清空上述文件、current_stage 改 INIT
5. 自动跳转到 wizard 第 6 步（章节大纲），用户可立即修改 `outline.json` 或回到 step 5 调整全书大纲
6. 后续走正常 STAGE4 重新推进流程

### 边界场景

- **项目刚初始化、还没写任何章节**：preview 显示 0 个草稿，弹窗文案降级为"项目目前无草稿可清理，仅将状态改回 INIT"，仍可执行（幂等）
- **managed 模式下点击**：执行后 autopilot 自动状态被清空（progress.json 没了）；下次启动 managed 会重新 seed_queue，按 progress 缺失视为全新开始。不在弹窗文案中显示 autopilot 警告（避免复杂的状态查询联动；managed 用户通常已在 UI 上暂停 autopilot）
- **用户在弹窗打开时切换章节**：弹窗保持打开，不冲突

## 非目标

- **不删除** `concept_and_dna.json` / `world.json` / `characters.json` / `novel_outline.json` / `outline.json` 等 init 阶段产物（用户已输入的内容保留）
- **不修改** `stage_history`（保留向前追溯记录）
- **不暂停** autopilot（不联动状态查询；用户自行决定何时点）
- **不导出备份**（破坏性操作无备份，依赖 git/projects 备份策略）

## 设计

### 架构

```
┌────────────────────────────────────────────────────────────────────┐
│ Frontend (React)                                                  │
│  ChapterTreePanel                                                │
│    [初始化]  [刷新]  [+ 新章节]    ← 新增"初始化"按钮（中性色）    │
│       │                                                          │
│       └─→ onInit() prop │
│            │ │
│  WorkspacePage / ManagedDashboard                                  │
│    onInit:                                                        │
│      GET /project/{id}/reset-preview  → 弹窗显示待删除内容计数 │
│      用户点"确认初始化"                                            │
│      POST /project/{id}/reset  → 成功后 navigate(/wizard)         │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ Backend (FastAPI) │
│  GET /project/{id}/reset-preview  列出将删除的文件/计数        │
│  POST /project/{id}/reset                                             │
│    └─ StageStateMachine.regress_to_init(id)                       │
│      1. unlink chapters/*.md                                     │
│       2. unlink progress.json                                      │
│       3. unlink .storyforge_checkpoint.json                       │
│       4. 清空 autopilot/chunks/ 目录                              │
│       5. project.json.current_stage = "INIT" (保留 stage_history) │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ Wizard deep-link                                                  │
│  /project/:id/wizard → WizardDeepLinkPage → InitWizardModal       │
│    resume=true                                                     │
│    自动 hydrate 已存在的 concept/world/character/novel_outline/ │
│    outline.json → 用户停留 step 6 (章节大纲)                     │
└────────────────────────────────────────────────────────────────────┘
```

### 组件改动

#### 1. 后端 — `backend/conductor/state_machine.py`

新增 `regress_to_init()` 方法：

```python
def regress_to_init(self, project_id: str) -> TransitionResult:
    """反向推进到 INIT：清空 stage4 运行时产物 + current_stage=INIT。
    原子性：任何文件 IO 失败都抛异常。
    不修改 stage_history —— 保留向前追溯。
    """
    project_dir = self._project_dir(project_id)
    if not project_dir.exists():
        return TransitionResult(
            allowed=False,
            from_stage=Stage.INIT,
            to_stage=Stage.INIT,
            message=f"项目 {project_id} 不存在",
        )

    # 1. 删章节草稿
    chapters_dir = project_dir / "chapters"
    if chapters_dir.exists():
        for f in chapters_dir.glob("ch*_scene_*_draft.md"):
            f.unlink()

    # 2. 删运行时状态
    for rel in ("progress.json", ".storyforge_checkpoint.json"):
        p = project_dir / rel
        if p.exists():
            p.unlink()

    # 3. 清 autopilot 流式 chunk 缓冲
    chunks_dir = project_dir / "autopilot" / "chunks"
    if chunks_dir.exists():
        for f in chunks_dir.glob("*.jsonl"):
            f.unlink()
        # 保留空目录结构方便后续 scene_chunk_store 直接写

    # 4. 改 project.json current_stage=INIT
    project_file = project_dir / "project.json"
    data = self._read_json(project_id, "project.json") or {}
    data["current_stage"] = Stage.INIT.value
    tmp = project_file.with_suffix(".tmp")
    import json
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, ensure_ascii=False, indent=2)
    tmp.replace(project_file)

    return TransitionResult(
        allowed=True,
        from_stage=Stage.INIT,
        to_stage=Stage.INIT,
        message="已重置到 INIT",
    )
```

#### 2. 后端 — `backend/api/project.py`

新增两个端点（紧邻 `delete_project` 第 117 行）：

```python
@router.get("/{project_id}/reset-preview")
async def reset_preview(project_id: str):
    """列出 /reset 将删除的文件与计数，用于前端 ConfirmDialog 文案。"""
    project_dir = settings.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail={
            "error": True,
            "code": "PROJECT_NOT_FOUND",
            "message": f"项目 {project_id} 不存在",
            "detail": {},
        })
    chapters_dir = project_dir / "chapters"
    draft_count = sum(1 for f in chapters_dir.glob("ch*_scene_*_draft.md") if f.is_file()) \
        if chapters_dir.exists() else 0
    chunks_dir = project_dir / "autopilot" / "chunks"
    has_chunks = chunks_dir.exists() and any(chunks_dir.glob("*.jsonl"))
    return {
        "draft_count": draft_count,
        "has_progress": (project_dir / "progress.json").exists(),
        "has_checkpoint": (project_dir / ".storyforge_checkpoint.json").exists(),
        "has_chunks": has_chunks,
    }


@router.post("/{project_id}/reset")
async def reset_to_init(project_id: str):
    """原子地清空章节草稿 + 运行时状态，并将 current_stage 写回 INIT。
    保留 concept/world/character/novel_outline/outline 等 init 阶段产物。
    保留 stage_history（向后追溯能力）。"""
    sm = StageStateMachine(settings.projects_dir)
    result = sm.regress_to_init(project_id)
    if not result.allowed:
        raise HTTPException(status_code=404 if "不存在" in result.message else 500, detail={
            "error": True,
            "code": "RESET_FAILED",
            "message": result.message,
            "detail": {},
        })
    return {
        "error": False,
        "code": "OK",
        "message": "项目已重置到初始化",
        "detail": {"project_id": project_id},
    }
```

#### 3. 前端 — `frontend/src/api/client.ts`

新增：

```ts
resetPreview: (projectId: string) =>
  request<{
    draft_count: number;
    has_progress: boolean;
    has_checkpoint: boolean;
    has_chunks: boolean;
  }>("GET", `/project/${projectId}/reset-preview`),

resetToInit: (projectId: string) =>
  request<{
    error: boolean;
    code: string;
    message: string;
    detail: { project_id: string };
  }>("POST", `/project/${projectId}/reset`),
```

#### 4. 前端 — `frontend/src/components/workspace/ChapterTreePanel.tsx`

在 `Props` 接口新增 `onInit?` 回调；在第 96-110 行渲染区"刷新"按钮**之前**插入新按钮：

```tsx
interface Props {
  // ... 现有字段
  onRefresh: () => void;
  /** v2.1: 初始化按钮回调。省略则不渲染该按钮。 */
  onInit?: () => void;
}

// 渲染（line 96-110 之间）：
{onInit && (
  <button
    type="button"
    data-testid="init-project"
    onClick={onInit}
    className="px-2 py-0.5 rounded text-xs bg-surface-container text-system-log hover:text-primary"
  >初始化</button>
)}
<button data-testid="refresh" onClick={onRefresh} ...>刷新</button>
```

#### 5. 前端 — `frontend/src/components/workspace/ManagedDashboard.tsx`

`Props` 新增 `onInit?` 并透传给 `<ChapterTreePanel />`：

```tsx
interface Props {
  // ... 现有字段
  onRefresh: () => void;
  onInit?: () => void;
}

// 渲染：<ChapterTreePanel ... onRefresh={onRefresh} onInit={onInit} />
```

#### 6. 前端 — `frontend/src/pages/WorkspacePage.tsx`

新增 state + 处理函数 + 弹窗渲染 + 传递 onInit 到两个组件：

```tsx
import ConfirmDialog from "../components/shared/ConfirmDialog";

// 在组件顶部新增 state
const [initPreview, setInitPreview] = useState<{
  open: boolean;
  preview?: {
    draft_count: number;
    has_progress: boolean;
    has_checkpoint: boolean;
    has_chunks: boolean;
  };
  busy: boolean;
}>({ open: false, busy: false });

const handleInit = useCallback(async () => {
  if (!projectId) return;
  try {
    const preview = await api.resetPreview(projectId);
    setInitPreview({ open: true, preview, busy: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    show(`预览失败：${msg}`);
  }
}, [projectId, show]);

const confirmInit = useCallback(async () => {
  if (!projectId) return;
  setInitPreview((s) => ({ ...s, busy: true }));
  try {
    await api.resetToInit(projectId);
    setInitPreview({ open: false, busy: false });
    navigate(`/project/${encodeURIComponent(projectId)}/wizard`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    show(`重置失败：${msg}`);
    setInitPreview((s) => ({ ...s, busy: false }));
  }
}, [projectId, show, navigate]);

// 在 ChapterTreePanel 上传 onInit={handleInit}
// 在 ManagedDashboard 上传 onInit={handleInit}

// 在 return JSX 末尾（确认其他 ConfirmDialog 位置风格一致）渲染：
<ConfirmDialog
  open={initPreview.open}
  title="初始化项目"
  message={buildInitMessage(initPreview.preview)}
  confirmLabel="确认初始化"
  cancelLabel="取消"
  onCancel={() => setInitPreview({ open: false, busy: false })}
  onConfirm={confirmInit}
  busy={initPreview.busy}
/>

// 辅助函数（在组件外或顶部）
function buildInitMessage(p?: {
  draft_count: number;
  has_progress: boolean;
  has_checkpoint: boolean;
  has_chunks: boolean;
}): string {
  if (!p) return "无法预览待删除内容。";
  const parts: string[] = [];
  if (p.draft_count > 0) parts.push(`${p.draft_count} 个章节草稿`);
  if (p.has_progress) parts.push("写作进度（progress.json）");
  if (p.has_checkpoint) parts.push("检查点（.storyforge_checkpoint.json）");
  if (p.has_chunks) parts.push("实时写作缓冲（autopilot/chunks/）");
  if (parts.length === 0) {
    return "项目目前无草稿可清理，仅将项目状态改回 INIT（章节大纲）。\n\n确认继续？";
  }
  return `将删除 ${parts.join("、")}，并将项目状态改回 INIT（章节大纲）。\n\n此操作不可恢复，确认继续？`;
}
```

**注意**：`ConfirmDialog` 当前接口（`components/shared/ConfirmDialog.tsx`）**不包含** `busy` prop。本设计**决定扩展 ConfirmDialog** 新增 `busy?: boolean` prop（默认 false）：true 时禁用确认按钮并显示 `progress_activity` spinner；这是受现有 ConfirmDialog 测试覆盖的最小扩展。如未来需要更复杂的禁用状态，可考虑独立 busy hook；本次不在范围。

### 数据流

```
用户点击"初始化"
    ↓
ChapterTreePanel.onInit() 回调
    ↓
WorkspacePage.handleInit()
    ↓
GET /project/{id}/reset-preview
    ↓
显示 ConfirmDialog（带预览文案）
    ↓
用户点击"确认初始化"
    ↓
WorkspacePage.confirmInit()
    ↓
POST /project/{id}/reset
    ↓
StageStateMachine.regress_to_init(id)
    ├── unlink chapters/*.md
    ├── unlink progress.json
    ├── unlink .storyforge_checkpoint.json
    ├── 清 autopilot/chunks/*.jsonl
    └── project.json.current_stage = "INIT"
    ↓
成功后 navigate(/project/{id}/wizard)
    ↓
WizardDeepLinkPage 渲染 InitWizardModal(resume=true)
    ↓
useEffect hydrate：发现 concept/world/character/novel_outline/outline.json 都存在
    ↓
标记 step 1-5 completed，跳到 step 6（章节大纲）
    ↓
用户停留在章节大纲页面，可立即修改 outline.json
```

## 错误处理

| 失败点 | 行为 |
|---|---|
| `GET /reset-preview` 失败 | ConfirmDialog 不打开；toast 显示错误；停留在 workspace |
| `POST /reset` 失败 | toast 显示错误；停留在 workspace；可能已部分删除（见"原子性评估"），用户可重试 |
| `reset-preview` 与 `reset` 之间文件被外部修改 | 用户可重新打开弹窗重取 preview；reset 接口幂等（已删除的文件跳过） |
| 用户取消弹窗 | 不做任何修改 |
| 用户在弹窗打开期间点击别的章节 | 弹窗保持打开（不冲突） |

**原子性评估（明确）**：`regress_to_init` **不实现严格回滚**。若在多次 unlink 中途发生异常（OSError 等），已删除的文件不会自动恢复，前端会收到错误 toast 并停留在 workspace。补救：用户重试 reset —— `regress_to_init` 是幂等的（已删除文件跳过；project.json 改 stage 也是覆盖写）。这是 v2.1 范围内的**明确权衡**：不引入两阶段提交（备份 tmp/ 再 rename）的复杂度，把"幂等重试"作为故障恢复路径。如果未来需要严格原子性，可引入"先备份到 `.reset_backup/` 再原子提交"的两步提交模式；本次不在范围。

## 测试

### Backend — `tests/test_reset_to_init.py`（新建）

1. `regress_to_init` 删除 chapters/*.md 但保留 outline.json
2. `regress_to_init` 删除 progress.json 和 .storyforge_checkpoint.json
3. `regress_to_init` 清空 autopilot/chunks/ 目录
4. `regress_to_init` 把 current_stage 改回 INIT
5. `regress_to_init` 保留 stage_history
6. `regress_to_init` 在不存在的项目上返回 allowed=False
7. `GET /reset-preview` 准确返回 draft_count、has_progress、has_checkpoint、has_chunks
8. `POST /reset` 幂等：第二次调用也成功

### Frontend — `frontend/src/test/ResetInitButton.test.tsx`（新建）

1. ChapterTreePanel 在 `onInit` 省略时不渲染"初始化"按钮
2. 点击"初始化"触发 `onInit` 回调
3. WorkspacePage onInit 调 resetPreview 后打开 ConfirmDialog 并显示 preview 文案
4. 取消按钮关闭弹窗不做任何事
5. 确认按钮先调 reset API 再 navigate
6. reset API 失败时显示 toast 不跳转

### 不写的测试

- E2E 浏览器测试（v2.1 范围内省略；后续手动验证）

## 文件改动清单

| 文件 | 改动类型 |
|---|---|
| `backend/conductor/state_machine.py` | 修改：新增 `regress_to_init()` 方法 |
| `backend/api/project.py` | 修改：新增2 个端点 |
| `frontend/src/api/client.ts` | 修改：新增 `resetPreview`、`resetToInit` |
| `frontend/src/components/workspace/ChapterTreePanel.tsx` | 修改：新增 `onInit?` prop、按钮渲染 |
| `frontend/src/components/workspace/ManagedDashboard.tsx` | 修改：透传 `onInit?` |
| `frontend/src/pages/WorkspacePage.tsx` | 修改：onInit 状态、ConfirmDialog 渲染 |
| `frontend/src/components/shared/ConfirmDialog.tsx` | 可能修改：扩展 `busy` prop（如需） |
| `tests/test_reset_to_init.py` | 新建 |
| `frontend/src/test/ResetInitButton.test.tsx` | 新建 |

## 后续工作（不在本次范围）

- 未来可引入"备份到 tmp/ 再 rename"的两步提交模式以保证原子性
- 未来可联动 autopilot 状态检查（暂停后再允许 reset）
- 未来可扩展为"恢复到指定步骤"的多档选择