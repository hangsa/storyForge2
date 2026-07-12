# StoryForge v1.9 + v1.8.1 — 产品设计需求文档

> v1.9 目标：把 v1.8 落地的"工作台"从 mock UI 升级为可操作的编排面板，同时清掉 v1.8.1 范围内的小尾巴、补齐 v1.7 两个挂账 AC（灵感路由器 AC-8、新颖度评估可复现性 AC-3）。


## 一、版本定位

### 1.1 从 v1.8 到 v1.9

```
v1.8                                            v1.9
────                                            ────
工作台仅有 mock UI（autopilotActive 本地 state）  → AutopilotSession 真后端会话 + SSE 事件流
工作台 AI 控制面板 4 tab 全 mock                 → 决策流/队列/检查/干预 接真实事件
ManagedStartModal 配置仅前端                     → 配置持久化到服务端 + 启动会话
Wizard 完成后跳 /stage1                          → Wizard 完成后跳 /workspace?mode=managed
BookShelf 按 created_at 排序                     → BookShelf 按 updated_at desc 排序
InitWizardConcept prefill 沿用 spread 合并        → InitWizard Concept prefill 严格合并
ContextPanel 6 tab 占位文字                       → ContextPanel 6 tab 挂载 Stage1/3/5/6 真组件
v1.7 AC-8 灵感路由器 ❌ 未实现                    → 灵感路由器（F1.7.7）落地（AC-8）
v1.7 AC-3 新颖度评估 ⚠️ 无显式可复现测试          → NoveltyEvaluator 可复现性测试（AC-3）
```

### 1.2 v1.8.1 vs v1.9 切分

- **v1.8.1**：纯前端小修 + 1 个轻量后端字段扩展，可在 v1.9 启动前的任何窗口独立交付。
- **v1.9**：后端会话/事件流/配置持久化的实质性工作 + 两个 v1.7 挂账 AC 的实现。

### 1.3 核心目标

| 目标 | 说明 |
|---|---|
| **工作台可信化** | 用户点击"启动托管"后看到的"AI 正在生成第 N 章"必须由后端实际跑任务支撑；UI 状态与服务端状态强一致（断线重连可恢复） |
| **编排入口闭环** | ManagedStartModal 选择 scope/cadence/policy/notify 后真的写入服务端并在下次进入项目时回显 |
| **工作台 = 项目主页** | Wizard 完成后直达工作台（而不是回 stage1 概念页），印证"工作台是项目唯一 hub"的承诺 |
| **数据完整性可见** | BookShelf 按真实 mtime 排序，反映用户最近活跃的项目；不再"陈旧项目永远置顶" |
| **挂账清零** | v1.7 唯一未实现 AC（灵感路由器 AC-8）+ 挂 ⚠️ 标记的可复现性测试（AC-3）一并落地，为 v1.10 重启奠定干净基线 |

### 1.4 范围与非范围

**范围（v1.9）**
- 工作台 autopilot 的真后端实现（AutopilotSession 模型 + 状态机 + SSE）
- AI 控制面板 4 tab 真事件流
- 工作台与设置/导航的接入收尾
- 灵感路由器（补 v1.7 AC-8）
- NoveltyEvaluator 可复现性测试（补 v1.7 AC-3）

**非范围（v1.10+，本文档不展开）**
- 跨项目资产复用（v1.7 §十展望里的 Global Idea Pool / Global Trope Pool）
- 协作疲劳感知
- 叙事重构模式
- Mid-Scene 草稿缓存
- PDF / EPUB 多格式导出
- 用户自定义矛盾模板
- 跨项目豁免反例学习


## 二、v1.8 当前基线状态

### 2.1 已实现（v1.8 范围）

| 模块 | 关键交付 | 状态 |
|---|---|---|
| **App.tsx 路由** | `/project/:id/workspace` 顶级路由 + 3 个 legacy redirect（`/stage4|5|6`） | ✅ |
| **`/stage1`、`/stage2`、`/stage3`、`/stage5`、`/stage6` 保留** | 独立页面与 workspace 并存；workspace 是项目 hub，原页面是 sub-editor | ✅ |
| **WorkspacePage** | 3 列 flex，按 mode 切换 left/center/right 内容 | ✅ |
| **WorkspaceLayout** | mode-aware slot（managed/manual） | ✅ |
| **WorkspaceTopBar** | 项目名 + mode badge + mode 切换 + 返回"项目中心" | ✅ |
| **WorkspaceModeSwitcher** | 段控件"托管/手动" | ✅ |
| **ModeSwitchConfirmModal** | managed → manual 二次确认 + "等待完成" toggle | ✅ |
| **ManagedStartModal** | manual → managed 配置（scope/cadence/policy/notify） | ✅（mock-only） |
| **ManagedDashboard** | 章节网格 + ManagedStatusStrip + 操作栏 + autopilot 启停 | ✅（mock state） |
| **ManagedStatusStrip** | "AI 正在 {currentTask}" 状态条 | ✅（mock text） |
| **ManagedAIControlPanel** | 4 tab（决策流/队列/检查/干预）+ 干预按钮 disabled | ✅（mock content） |
| **ChapterTreePanel** | manual 模式左侧章节树 | ✅ |
| **WritingArea** | manual 模式中央写作区（fork 自 Stage4Page） | ✅ |
| **ContextPanel** | manual 模式右侧 6 tab（concept/world/character/outline/diagnosis/export） | ✅（API-fetch + 占位 body） |
| **`useWorkspaceMode` hook** | URL ↔ state + localStorage backup；默认 managed | ✅ |
| **`useWorkspacePanel` hook** | URL ↔ `?panel=` 同步，6 个合法值 | ✅ |
| **BookShelf** | 显示最近 5 个项目，搜索、多选、批量删除、查看全部 → BookShelfModal | ✅（按 created_at desc，⚠️ 非真实 mtime） |
| **InitWizard（6 步）** | Concept → World → Character → Outline → 6 章大纲 → 完成 | ✅（完成后跳 `/stage1`） |
| **Sidebar / MainLayout** | 移除 workspace 三项入口；workspace 是顶级路由而非侧栏子项 | ✅ |

### 2.2 v1.8 限制（v1.8.1 + v1.9 要解决）

| 限制 | 影响 | 处理版本 |
|---|---|---|
| 工作台所有"AI 状态"是 `useState` 本地态 | 刷新页面后所有 mock 状态归零；用户看到"启动托管"再进来变成"未启动" | v1.9 |
| ManagedAIControlPanel 4 tab 全是写死 mock | 决策流/队列/检查/干预无任何意义 | v1.9 |
| ManagedStartModal 配置只在内存 | 重新进入项目需重新选；不能让 Writer 拿到真实 cadence/policy | v1.9 |
| `useWorkspaceMode` 仅写 localStorage | 多设备登录/浏览器切换无法同步 | v1.9（次要） |
| WorkspaceTopBar 进度环是 placeholder | 用户看不到真的写作进度 | v1.9 |
| ContextPanel 6 tab 是占位 body | 用户点 "概念/世界观/角色/大纲/诊断/导出" 看不到真实编辑器 | **v1.8.1** |
| Wizard 完成后跳 `/stage1` | 与"workspace 是 hub"承诺不一致 | **v1.8.1** |
| BookShelf 按 `created_at desc` | 陈旧项目长期占据置顶；无法反映"最近活跃" | **v1.8.1** |
| InitWizard Concept prefill 用 spread 合并 | `story_dna` 字段在某些 shape 变更下会丢（具体见 v1.8 plan L2638） | **v1.8.1** |
| v1.7 AC-8 Inspiration Router 仍未实现 | 用户在多轮讨论中的灵感一闪而过、无自动捕捉 | v1.9 |
| v1.7 AC-3 NoveltyEvaluator 无显式可复现测试 | 评分波动范围 < ±5 分仅是声明，验证缺失 | v1.9 |

### 2.3 v1.8.1 任务被 v1.9 路线图预先消费的项

| v1.8.1 任务 | 是否影响 v1.9 设计 |
|---|---|
| BookShelf 按真实 mtime 排序 | 影响 `/api/project/list` 的响应字段 → v1.9 AutopilotSession API 同样要带 `updated_at`；可一并设计 |
| ContextPanel 挂载真组件 | ContextPanel 是 manual mode 的右栏；不动 managed mode 任何东西，与 v1.9 autopilot 后端解耦 |
| Wizard 完成后跳 `/workspace` | 只改前端导航；与 v1.9 autopilot 无关 |


## 三、v1.8.1 待实现功能（短期小修）

> 全部为前端小修 + 一个轻量后端字段扩展。v1.9 动工前/后均可独立交付。代码位置标注形式：`file:line` 或 `plan-file:行号`。

### F1.8.1.1 BookShelf 按真实 updated_at 排序

**目标：** BookShelf 反映用户最近活跃的项目，而不是创建顺序。

**当前状态（参考 `2026-07-09-v1.8-home-page.md` L2101-2104 + L2300）：**
- `HomePage.tsx` 把 `mtimes` prop 硬编码为 `[]`，BookShelf 实际按 `created_at desc` fallback
- 后端 `/api/project/list`（参见 `backend/api/project.py`）只返回创建项目时落盘的 `project.json` 字段，缺 `updated_at`

**改动：**

| 范围 | 改动 |
|---|---|
| 后端 `project.py` | `/api/project/list` 响应额外字段 `updated_at: number`（Unix 秒）；从项目目录下最近被改写过文件的 `Path.stat().st_mtime` 取最大 |
| `HomePage.tsx` | 把后端返回的 `updated_at` 折叠成 `mtimes` 传给 `BookShelf` |
| `BookShelf.tsx` | 不动（已支持按 `mtimes` desc） |

**验收：** BookShelf 上 5 个项目按"最近活跃"排序；通过修改 `outline.json` 后再访问首页验证：刚改完的项目排第一。

**风险：** 大项目列表（如 249+ 个）的目录扫描 `stat()` 性能；用 `os.scandir` 一次完成即可，避免 `Path.rglob`。

### F1.8.1.2 InitWizard Concept prefill story_dna 回归测试

**目标：** 锁定 `WizardData` 中 `story_dna` 与 `concept` 作为独立兄弟字段的行为，防止未来重构把它们合并成一字段而破坏 prefetch。

**当前状态（参考 `WizardContext.tsx` L10-23、L159-168 + `2026-07-09-v1.8-init-wizard.md` L2638）：**
- `WizardData` 已经是 `{ concept: Concept | null, story_dna: StoryDNA | null, ... }` 顶级兄弟字段
- `HYDRATE_FROM_FILES` reducer 用 `data: Partial<WizardData>` 直接 spread，不存在 `story_dna` 被吞进 `concept` 的代码路径
- 风险：未来若有人把 `concept` 改成嵌套 `{ concept, story_dna }`，prefill 会丢字段，且没有测试兜底

**改动（无生产代码改动，仅补测试）：**
- `frontend/src/test/WizardContext.test.tsx`：新增 case
  - "hydrateFromFiles preserves top-level `story_dna`" — seed `{ concept: <c>, story_dna: <dna> }`，断言 hydrate 后两者独立保留
  - "saveStep(patch with only concept) does not clear story_dna" — 测 saveStep 仅 patch 部分字段时的不可变性

**验收：** 两条新 case green；CI 锁定 `data.story_dna` 独立性。

### F1.8.1.3 ContextPanel 6 tab 全部跳转（v1.8.1 MVP）

**目标：** manual mode 右栏不再是 placeholder 文字；每个 tab 明确给出"在完整页面查看/编辑"的入口。

**MVP 范围说明：** design doc 初稿本节设想"抽离 4 个 Stage1/2/3 内联编辑器"（concept/world/character/outline 共 4 组件 + outline grid）。但 `Stage1Page.tsx` 293 行 / `Stage3Page.tsx` 442 行，且分别嵌入在 `Stage1Layout` 子标签 + generate/advance 流里；做完整抽离是 1.5–2 周工作，不在 v1.8.1 phase 0 的 1 周窗口内。本节改用 MVP：6 个 tab 全部跳转到对应 Stage 完整页面。

**当前状态（参考 `2026-07-11-v1.8-project-workspace.md` L3209）：**
- ContextPanel 6 tab 调对应 API 拉数据但渲染"内联编辑面板待 v1.8.1 接入"占位

**MVP 改动：**
- ContextPanel tab body 不再展示占位字符串；改为：
  - 顶行：tab 标题 + 数据加载状态（沿用现有 fetcher 拉 API）
  - 中行：数据预览（如 concept: title + genre + premise 三行；world: era + 两条 social structure 截断；character: 主角色列表前 5；outline: 章节编号 + 标题；diagnosis/export: "由 Stage5/Stage6 提供"）
  - 底行：`<Link>` 按钮"在完整页面编辑 →"对应 `/project/:id/stage1|stage2|stage2(角色)|stage3|stage5|stage6`

**v1.9 stage 1 增量：** 把 6 tab 升级为真正的内联编辑器（design doc 初稿描述的"抽离"工作），与 Conductor 重构同步推进。

**验收（v1.8.1）：** 在 workspace 手动模式下点右栏 6 个 tab 任一个，看到数据预览 + 一键跳转到独立 Stage 页面的链接。

### F1.8.1.4 Wizard finish 跳转 ✅ **已实现**

**状态：** v1.8 plan Task 18 已落地；`InitWizardModal.tsx:123` 当前就是 `navigate('/project/${encodeURIComponent(projectId)}/workspace?mode=managed')`。本节留作"不需工作"的占位——保留以便后续 v1.9 收尾时再次确认行为。

**仍需验证项：**
- `frontend/src/test/InitWizardModal.test.tsx` 中"finish 后跳 workspace URL"这条 case 确实存在（参考 `2026-07-09-v1.8-init-wizard.md` L2632 + `2026-07-10-v1.8-wizard-auto-trigger.md` 任务列表）
- 若有回归则补 case：覆盖"用户拒绝 dismiss 弹窗时也已完成导航"，避免后续把 `navigate` 改成 `useEffect`-driven 时漏触发

**验收：** wizard 跑完后跳到工作台托管模式；点击"启动托管"才能进入写作状态。

### F1.8.1.5 BookShelfModal STAGE 链接一致性（顺带收尾）

**目标：** v1.8 早期修过的 BookShelfModal 导航（proj_571e8f74 跳错页面 bug）在更广 stage 范围上验证一遍。

**当前状态（参考 `BookShelfModal.test.tsx`）：**
- 已加 STAGE4+ → workspace、STAGE2 → wizard 的回归测试

**改动：**
- 在 BookShelfModal 测试里加 case：STAGE5/6 → `/project/:id/stage5`/stage6（不通过 workspace 跳转——这些阶段用户去的是全屏诊断/导出页）
- 在 BookShelfModal 的 stage→path 表里补充 STAGE5/6 分支

**验收：** STAGE5 项目点进去直接进入诊断页；STAGE6 直接进入导出页。

> F1.8.1.1–F1.8.1.5 全部可在 v1.9 启动前一两个 sprint 内完成，零依赖。建议一次性单 PR 提交。


## 四、v1.9 工作台 mock → 真实编排

> 核心新增：从 0 设计一个 **AutopilotSession** 模型，让工作台所有"AI 状态"由后端持久化、按事件流推送给前端。设计原则：① 工作台是事件流的订阅者、不是状态持有者；② 状态机在服务端，前端是可视层；③ 配置与会话分离，多设备/多标签页可以同步看到同一个 session 状态。

### F1.9.1 AutopilotSession 后端会话模型

**目标：** 给每个项目一个可启停、可恢复、可被多端订阅的"托管会话"。

**存储：** `<project_dir>/autopilot/session.json`（与服务端 checkpoint 共置一处便于恢复）

**数据结构：**

```python
@dataclass
class AutopilotSession:
    project_id: str
    state: Literal["idle", "running", "paused", "stopped", "error"]
    config: ManagedStartConfig          # 见 F1.9.3
    started_at: Optional[str]            # ISO8601
    last_heartbeat_at: Optional[str]     # ISO8601；超过 30s 未更新视为断线
    current_task: Optional[CurrentTask]  # 当前正在跑的子任务（见下）
    queue: list[QueueItem]               # 排队计划任务
    history: list[SessionEvent]          # 已发生事件，可回放
    circuit: CircuitSnapshot             # v1.6 熔断器当前状态（强制通过次数等）

@dataclass
class CurrentTask:
    kind: Literal["plan_chapter", "write_scene", "fact_guard", "review", "archival", "diagnosis"]
    chapter_number: Optional[int]
    scene_id: Optional[str]
    status: Literal["queued", "active", "blocked", "completed", "failed"]
    started_at: Optional[str]
    description: str                     # 给前端展示："生成第 7 章"
    progress_pct: Optional[int]          # 0-100，写作中段进度；v1.9.x 再实现

@dataclass
class QueueItem:
    id: str
    kind: str                            # 同 CurrentTask.kind
    chapter_number: Optional[int]
    scheduled_at: Optional[str]
    priority: int                        # 越低越靠前
    payload: dict                        # 子任务参数（planning / writing 各自的 schema）
```

**事件日志（`history`）：**
```python
@dataclass
class SessionEvent:
    id: str
    at: str                              # ISO8601
    type: Literal["task_start", "task_complete", "task_fail", "decision", "intervention",
                  "checkpoint", "circuit_open", "circuit_close", "queue_add", "queue_drop"]
    task_id: Optional[str]
    chapter_number: Optional[int]
    payload: dict
```

**状态机：**
```
idle ──[start]──► running ──[pause]──► paused ──[resume]──► running
                     │                     │
                     │                     └─[stop]──► stopped
                     ├─[stop]──► stopped
                     ├─[circuit_open]──► paused（自动暂停）
                     └─[fatal error]──► error（要求用户干预）

stopped ──[start]──► running（沿用旧 config）
paused  ──[start]──► running（沿用旧 config；如有 stop 记录则报错但不阻断）
error   ──[start]──► idle → running（清除 error 状态后重启）
```

**API 新增：**

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/projects/{id}/autopilot/session` | GET | 返回当前 session 快照（`AutopilotSession` 全量 JSON），404 表示无 session |
| `/api/v1/projects/{id}/autopilot/session/start` | POST | 接受 `ManagedStartConfig`，创建或恢复 session 到 running；写入 `history[0] = task_start` |
| `/api/v1/projects/{id}/autopilot/session/stop` | POST | 优雅停止：完成当前 task → 状态转 stopped，保留 queue |
| `/api/v1/projects/{id}/autopilot/session/pause` | POST | 立即暂停：保留 current_task；queue 不变 |
| `/api/v1/projects/{id}/autopilot/session/resume` | POST | paused → running，从 current_task 继续 |
| `/api/v1/projects/{id}/autopilot/session/intervene` | POST | 接管式操作（pause immediate / rollback to checkpoint / stop current task） |
| `/api/v1/projects/{id}/autopilot/session/events` | GET | SSE 长连接；前端订阅用 |
| `/api/v1/projects/{id}/autopilot/session/history` | GET | 历史事件流分页（cursor-based） |

**实现要点：**
- 后端 `backend/conductor/autopilot_session.py`（新文件）实现状态机 + 持久化 + SSE 广播
- SSE 广播用 `asyncio.Queue` 多订阅者扇出，断线重连从 `last_event_id` 重放（Last-Event-ID 头是 SSE 标准）
- 当前 task 的实际执行：v1.9 复用现有 `Conductor + StageStateMachine` 的章节级推进；v1.9 不引入新的 LLM 调用路径，只在 STAGE 4 章节写作流水线上加一个"AutopilotSession 驱动模式"

**关键不变量：**
- session.json 每次状态转换都落盘（write-through），崩溃后从 `last_heartbeat_at` + `state` 决定恢复策略
- SSE 事件先入 `history[]` 再广播，保证重放与真实一致
- `circuit` 字段反映 v1.6 熔断器在当前 session 内的累计强制通过次数，超阈值下次重复触发时给写警示（不阻断）

### F1.9.2 SSE 实时事件流（接 ManagedAIControlPanel 4 tab）

**目标：** 把 v1.8 mock 4 tab（决策流/队列/检查/干预）接上真实事件流。

**事件类型映射：**

| tab | 订阅事件 | 显示 |
|---|---|---|
| 决策流 | `decision` `task_complete` `circuit_open` `circuit_close` | 时间倒序的事件卡片 |
| 队列 | session 全量快照的 `queue[]` | 当前排队任务 list |
| 检查 | `task_fail`（带 circuit 信息） | 最近 N 次失败检查 |
| 干预 | 会话级按钮 | 接管时操作（pause immediate / rollback to checkpoint / stop current task） |

**前端改造：**
- `frontend/src/components/workspace/ManagedAIControlPanel.tsx`：去掉所有 mock；改为订阅 `/autopilot/session/events`
- 新建 `frontend/src/hooks/useAutopilotSession.ts`：封装 SSE 订阅、断线重连、Last-Event-ID 重放
- `ManagedDashboard` 的 `autopilotActive` prop 改为订阅 `session.state === "running"`，不再用本地 `useState`
- `ManagedDashboard` 的 `onToggleAutopilot` 改为调 `/session/start` 或 `/session/stop`（按当前 state 二选一）

**断线策略：**
- SSE 断 → 前端 1s 后重连，重连请求带 `Last-Event-ID` → 后端从该 ID 之后的事件重新推
- 后端 session 丢失（被外部停止） → 重连时 GET 拉到 404 → 前端跳回 stopped UI

**降级策略：**
- SSE 服务不可用 → 前端回退到"每 5 秒 poll session 全量"（功能不丢，仅实时性降级）
- 后端 LLM 调用超时 → 见 v1.6 CircuitBreaker 行为，自动 circuit_open

### F1.9.3 ManagedStartModal 配置前端封装

**目标：** 前端拉/存 `AutopilotSessionConfig` 的客户端封装；持久化的"落盘"工作归 F1.9.1（`AutopilotSession.config` 字段）。

**与 F1.9.1 的边界（避免重复）：**
- F1.9.1 负责：`/session/start` 接收 `config` → 写入 `session.json` 落盘；`GET /session` 返回的 `config` 字段作为回显依据
- F1.9.3（本节）负责：前端 API 封装 + ManagedStartModal 打开时预填 + 提交时回传

**当前状态（参考 `frontend/src/components/workspace/ManagedStartModal.tsx` L32）：**
- 配置仅本机 UI；提交后不入后端

**改动：**
- 新建 `frontend/src/api/autopilot.ts`：暴露 `getAutopilotSession(projectId)`、`startAutopilotSession(projectId, config)`、`stopAutopilotSession(projectId)`、`pauseAutopilotSession(projectId)`、`resumeAutopilotSession(projectId)`
- `ManagedStartModal.tsx`：打开时 GET `/session` 取 `config` 字段预填；提交时 POST `/session/start` 把 config 一并交给后端（不直接 PUT 单独 config 端点）
- 后端 config 落盘由 F1.9.1 的 `/session/start` 完成

**数据结构：** `ManagedStartConfig`（已存在于 v1.8 mock）：
```typescript
interface ManagedStartConfig {
  scope: "all_planned" | "next_chapter"
  cadence: "fast" | "balanced" | "careful"
  policy: "auto" | "ask"
  notify: "all" | "milestones"
}
```

**回显：** GET `/session` 拿到 `config` 字段 → 进入项目时预填 + 提交时回传。后端会话存在但 config 为空时回退到 v1.8 默认值（balanced/auto/milestones/all_planned）。

### F1.9.4 WorkspaceTopBar 进度环接入真实数据

**目标：** TopBar 进度环从 placeholder 改为"已完成章节 / 总章节 + 当前 AI 状态"。

**当前状态（参考 `2026-07-11-v1.8-project-workspace.md` L646 占位测试）：**
- `WorkspaceTopBar.tsx` 有一个 placeholder 进度环测试

**改动：**
- `WorkspaceTopBar.tsx`：进度环改为 `completed_chapters / total_chapters`（从 `progress.json` 算）+ 居中标签 "AI 正在 X" 或 "托管未启动"
- 数据来源（参考 `backend/models/outline.py:55` `Outline.chapters: list[Chapter]` + `backend/models/progress.py:29-50` `ChapterProgress` + `ProgressFile`）：
  - `GET /api/v1/projects/{id}/progress` 返回 `ProgressFile`，含 `total_chapters: int` + `chapters: list[ChapterProgress]`（每章带 `status: "pending" | "in_progress" | "completed"`）
  - `total = ProgressFile.total_chapters`
  - `done = progress.chapters.filter(c => c.status === "completed").length`（不计入 `in_progress` ——那章不算完成）
  - session.state === "running" → "AI 正在 {CurrentTask.description}"；其他 → "未启动" 或 "已暂停"
- **不在 `outline.json` 上读 status**：`Chapter`（`outline.py:49`）**没有 status 字段**，status 仅在 `progress.json` 中。如果前后端直接从 outline 过滤会拿到 undefined。
- 进度环颜色：100% → 绿；50–99% → 主色；<50% → 琥珀；0% → 灰

**验收：** 完成章节数变化时进度环立刻更新（订阅 outline 变化或手动触发刷新）。

### F1.9.5 useWorkspaceMode / useWorkspacePanel 服务端持久化（次要）

**目标：** 多设备/多标签页同步 mode 和 panel。

**改动：**
- 现有 `useWorkspaceMode` / `useWorkspacePanel` 主要从 URL 读，写到 localStorage 作 backup
- v1.9 加可选服务器端持久化：`PUT /api/v1/users/me/preferences` 接受 `{ workspace_mode, workspace_panel }`
- 启动时优先服务器、其次 localStorage、最后 URL
- 这是 nice-to-have，不阻塞其他工作；如果时间紧可推迟到 v1.9.1

**验收：** Chrome A 切到 manual → Chrome B 打开同一项目也是 manual（30s 内同步）。


## 五、v1.9 灵感路由器（F1.7.7，补 AC-8）

> 直接实现 v1.7 spec F1.7.7 全部规格，补全 v1.7 唯一未完成 AC。

### F1.9.6 灵感路由器

**目标：** 全部 Agent 对话和用户交互中持续运行，自动捕捉、分类、存储灵感，避免一闪而过的创意被遗忘。

**触发时机（全阶段覆盖）：**

| 阶段 | 触发场景 | 捕捉内容 |
|---|---|---|
| INIT | 项目初始化 Agent 讨论 | 世界观灵感、角色构思 |
| STAGE 1 | 创意画布交互 | 用户偏好的方向、标记的节点 |
| STAGE 2 | 世界观/角色设计讨论 | 新角色想法、世界观细节 |
| STAGE 3 | 大纲/情节讨论 | 情节转折想法、伏笔构思 |
| STAGE 4 | Scene 写作 | Writer 在写作中产生的"可以这样写"的灵感 |
| STAGE 5 | 诊断讨论 | 修复建议、改进方向 |
| 全部阶段 | 用户手动触发"捕捉灵感" | 用户在讨论中随时想到的任何东西 |

**分类逻辑（Tier 3 模型）：**

```
用户输入（对话文本 / 手动捕捉内容）
        │
        ▼
  Tier 3 分类器（~50 tokens）
        │
        ├── 置信度 ≥ 0.8 单一分类 → 直接归入对应 Idea Pool 类别
        ├── 置信度 0.5-0.8 → 归类 + "待确认"标签
        ├── 多分类差距 > 0.3 → 归类到最高置信度
        └── 多分类差距 ≤ 0.3 → 多标签"跨类"标记
```

**Idea Pool 类别体系（沿用 v1.7 F1.7.1.1）：**

| 类别 | 说明 |
|---|---|
| 设定灵感 | 世界观、力量体系、世界观规则 |
| 剧情想法 | 具体情节点、转折、冲突构思 |
| 角色灵感 | 角色设定、关系、成长方向 |
| 风格偏好 | 写作风格、句式偏好、节奏取向 |
| 写作灵感 | 具体场景的写法灵感 |

**Idea 数据结构：** 沿用 v1.7 spec，`idea_pool.json` 项目级存储。

**多分类冲突处理示例：**
- "如果主角的能力不是修炼来的而是被植入的" → 设定灵感(0.6) 剧情想法(0.55) → 差距 0.05 ≤ 0.3 → 双标签"跨类-设定/剧情"
- "林峰和苏晓晓其实是失散多年的兄妹" → 剧情想法(0.7) 角色灵感(0.3) → 差距 0.4 > 0.3 → 归类为"剧情想法"

**用户纠错操作：**

| 操作 | 说明 |
|---|---|
| 重新分类 | 用户将灵感从"设定灵感"改为"角色灵感" |
| 拆分 | 一条灵感包含多个独立想法，拆分为多条 |
| 合并 | 两条灵感本质上是同一个想法，合并 |
| 标记无效 | 标记为噪音，不计入分类准确率统计 |
| 编辑内容 | 修改灵感文本，使其更精炼 |

**实现要点：**
- `backend/inspiration/router.py`（参考 v1.7 TRD L230 设计）：分类器 + 触发调度 + Idea Pool 写入
- `backend/api/inspiration.py`（新）：`GET /api/v1/projects/{id}/ideas`、`POST /api/v1/projects/{id}/ideas`、`PUT .../ideas/{idea_id}`（重新分类 / 编辑）、`DELETE .../ideas/{idea_id}`、`POST .../ideas/merge`、`POST .../ideas/split`、`POST .../ideas/capture`（手动触发）
- 触发点接入：每个 Agent 完成对话后调 `router.catch_from_conversation(turns)`；用户在 Stage 5/各 Agent 讨论 UI 上有"捕捉灵感"按钮
- 噪音控制：用户可在 Settings 配置"灵感路由器灵敏度"（低/中/高），低灵敏度只捕获 ≥ 0.85 置信度的；高灵敏度全捕获

**LLM 配置（沿用 v1.7）：**
- Tier 3 (Claude Haiku)，~50 tokens 输入 + ~30 tokens 输出
- 每次约 $0.00005；每章约 5 次（3 个 Agent 对话 + 2 次用户交互），20 章合计 ~$0.005

**Settings 集成：**
- `SettingsPage.tsx` 新增"灵感路由器"区块：灵敏度选择、按类别/来源阶段/关联元素筛选、查看全部已捕获灵感

**验收（v1.7 AC-8）：** 灵感路由器从一次 10 轮讨论中正确捕捉 ≥ 3 条灵感，且分类准确（人工验证分类标签与内容匹配）。

### F1.9.7 Idea Pool 跨项目导入入口（v1.7 留口子）

v1.7 spec F1.7.1.1 提到"新建项目时可从 Global Idea Pool（跨项目灵感库，v1.8 实现）导入"。v1.8 没做；v1.9 只做"导入入口 UI + 后端过滤本项目内灵感"，Global Idea Pool（跨项目）留 v1.10。

**v1.9 范围：** 项目内 Idea Pool 的导入在新建项目 wizard 的 Step 1 显示"从已有项目借鉴灵感"开关，加载完成后用户可勾选带入新项目。


## 六、v1.9 NoveltyEvaluator 可复现性测试（F1.7.1，补 AC-3）

> v1.7 spec AC-3 声明"评分波动范围 < ±5 分"但无显式可复现测试。CLAUDE.md 把这条标记为 ⚠️。v1.9 补上。

### F1.9.8 NoveltyEvaluator 可复现性验证

**目标：** AC-3 形式化验收。

**验收定义（沿用 v1.7 spec L904）：** 同一 Story DNA 输入 → 连续 3 次评估 → 分数极差 ≤ 4。

**实现：**
- `tests/test_creative_os/test_novelty_evaluator_ac3.py`（参考 v1.7 TRD L1301 已有 spec）：
  - 固定 input：取 v1.7 acceptance test fixture 里的 `sample_story_dna.json`
  - 固定 model fixture：mock Tier 3 LLM 返回固定标签列表（不引入真实模型波动）
  - 连续调 `NoveltyEvaluator.evaluate(input)` 3 次，记录 4 维分数
  - 断言 `max(scores) - min(scores) <= 4`（< 5 分）
- 模型 mock 策略：用 v1.7 TRD L1484 推荐的"LLM 返回确定性结果 + temperature=0.3"；temperature 在测试 fixture 里再下设到 0，模拟"同输入同输出"

**边界：** 在测试环境中跳过真实 Tier 3 调用，节省成本同时保证结果稳定。

**验收：** CI 中 `pytest -k ac3` 通过；评估器改动后此测试必须仍 green。


## 七、前端页面 / 组件变更清单

### 7.1 改造页面

| 页面 | 改造内容 | 版本 |
|---|---|---|
| `HomePage.tsx` | 把后端 `updated_at` 折成 `mtimes` 传给 `BookShelf` | v1.8.1 |
| `InitWizardModal.tsx` | finishWizard 跳 `/workspace?mode=managed` | v1.8.1 |
| `BookShelfModal.tsx` | STAGE5/6 链接到独立 page | v1.8.1 |
| `WorkspacePage.tsx` | `autopilotActive`/`currentTask` 改用 hook，不存本地 state | v1.9 |
| `ManagedDashboard.tsx` | autopilot toggle 调 `/session/start` 或 `/session/stop`；chapters/queue 数据从 session 取 | v1.9 |
| `ManagedStatusStrip.tsx` | currentTask 来自 session.current_task.description | v1.9 |
| `ManagedAIControlPanel.tsx` | 4 tab 接 SSE 事件流；干预按钮按 session.state 启用 | v1.9 |
| `ManagedStartModal.tsx` | open 时 GET config 预填；submit 时 POST `/session/start` | v1.9 |
| `WorkspaceTopBar.tsx` | 进度环替换为已完成章节/total；中间态从 session 取 | v1.9 |
| `ModeSwitchConfirmModal.tsx` | `currentTask`/`queueLength` 从 session 拿，不再硬编码 | v1.9 |
| `ContextPanel.tsx` | 6 tab 挂载真组件：concept/world/character/outline 内联编辑 + diagnosis/export `<Link>` | v1.8.1 |
| `WizardContext.tsx` | `hydrateFromFiles` 严格合并 `story_dna` 不再 spread 进 concept | v1.8.1 |
| `SettingsPage.tsx` | 新增"灵感路由器"区块（灵敏度、已捕获列表） | v1.9 |

### 7.2 新建组件 / Hook / API

| 名称 | 路径 | 说明 |
|---|---|---|
| `useAutopilotSession` | `frontend/src/hooks/useAutopilotSession.ts` | 封装 SSE 订阅 + Last-Event-ID 重放 + 心跳 |
| `useAutopilotConfig` | `frontend/src/hooks/useAutopilotConfig.ts` | 拉取/保存 ManagedStartConfig |
| `ConceptEditor` | `frontend/src/components/workspace/inline/ConceptEditor.tsx` | Stage1 concept form 抽离（v1.8.1） |
| `WorldEditor` | 同上 | Stage2 world form 抽离（v1.8.1） |
| `CharacterEditor` | 同上 | Stage2 character form 抽离（v1.8.1） |
| `OutlineEditor` | 同上 | Stage3 outline grid 抽离（v1.8.1） |
| `InspirationPanel` | `frontend/src/components/inspiration/InspirationPanel.tsx` | 列表 + 手动捕捉 + 纠错 UI |
| `ApiAutopilot` | `frontend/src/api/autopilot.ts` | SSE 客户端 + REST CRUD 封装 |
| `ApiInspiration` | `frontend/src/api/inspiration.ts` | Idea CRUD |

### 7.3 新建后端模块

| 名称 | 路径 | 说明 |
|---|---|---|
| `AutopilotSession` 模型 | `backend/conductor/autopilot_session.py` | 状态机 + 持久化 |
| `AutopilotRunner` | `backend/conductor/autopilot_runner.py` | 把 session 调度到现有 Conductor + StageStateMachine 上 |
| `SSEBroadcaster` | `backend/utils/sse_broadcaster.py` | 多订阅者事件扇出，含 Last-Event-ID 协议 |
| `Inspiration Router` | `backend/inspiration/router.py` | 分类器 + 触发调度（参考 v1.7 TRD L230） |
| `Idea Pool Service` | `backend/inspiration/idea_pool.py` | CRUD + 跨项目过滤 |
| API routes | `backend/api/autopilot.py`、`backend/api/inspiration.py` | 9 + 7 个端点 |

### 7.4 删除

无删除项。v1.8 占位组件保留作为 fallback（前端用 `if (session)` 切换真/假数据）。


## 八、验收标准

| 编号 | 验收项 | 对应功能 |
|---|---|---|
| AC-1 | BookShelf 5 个项目按真实最近活跃时间倒序，修改 `outline.json` 后下次访问首页该项目排第一 | F1.8.1.1 |
| AC-2 | InitWizard Step 1 退出后重进，`data.story_dna` 与后端 `getConcept` 返回的 `story_dna` 完全一致 | F1.8.1.2 |
| AC-3 | ContextPanel concept/world/character/outline tab 编辑字段并保存后，对应 `project.json` 字段更新；diagnosis/export tab 跳独立 Stage 页面 | F1.8.1.3 |
| AC-4 | InitWizard finish 后跳 `/project/:id/workspace?mode=managed`，不在 `/stage1` | F1.8.1.4 |
| AC-5 | 点击"启动托管"调 `/session/start`，5s 内 `session.state` 变 running；ManagedStatusStrip 出现并显示真实 CurrentTask.description | F1.9.1, F1.9.2 |
| AC-6 | running 状态点"停止托管"调 `/session/stop`，优雅停止；状态经 running → stopped，且 current task 完成后才转 stopped | F1.9.1 |
| AC-7 | ManagedAIControlPanel 4 tab 在 session running 时显示真实事件流（决策流可看到 TaskCompleteEvent，队列显示真实 queue，干预按钮启用） | F1.9.2 |
| AC-8 | ManagedStartModal 提交后 GET `/session` 看到 `config` 落盘；重新进入项目 modal 预填上次配置 | F1.9.1（落盘）, F1.9.3（前端封装 + 预填） |
| AC-9 | 灵感路由器从一次 10 轮讨论中正确捕捉 ≥ 3 条灵感，且分类准确（沿用 v1.7 AC-8） | F1.9.6 |
| AC-10 | NoveltyEvaluator 同一输入 3 次评分极差 ≤ 4（沿用 v1.7 AC-3） | F1.9.8 |
| AC-11 | SSE 断线 1s 后自动重连，重连请求带 Last-Event-ID，断线期间事件不丢失 | F1.9.2 |
| AC-12 | WorkspaceTopBar 进度环显示已完成章节数 / 总章节数，颜色按比例变化 | F1.9.4 |
| AC-13 | Chrome A 切到 manual → Chrome B 打开同一项目也是 manual（30s 内同步） | F1.9.5 |


## 九、Token 预算

### 9.1 v1.9 增量消耗

| 任务 | 模型 | 单次 tokens | 频率 | 备注 |
|---|---|---|---|---|
| 灵感路由器分类 | Tier 3 (Haiku) | ~50 in + 30 out | 每章约 5 次 | 沿用 v1.7 spec，沿用 AC |
| 当前 task 进度上报 | 零 LLM（节级）/ N/A（场景级，v1.9.x） | — | session 每次心跳（30s） | 节级（chapter）进度由 `progress.json` 直接推；场景级 `progress_pct` 在 v1.9.x 引入，v1.9 不上报细粒度进度 |
| SSE 重连历史回放 | 零 LLM | — | 断线时 | 事件重放无 LLM 调用 |
| ManagedStartModal 配置 | 零 LLM | — | 用户每次手动 | 纯持久化 |

**v1.9 单章 token 增量：~0.4K（仅灵感路由器沿用 v1.7 摊销）；启动/停止/状态查询全部零 LLM。**

**v1.9 一次性 token 增量：灵感路由器首次分类模型预热 ~50 tokens，可忽略。**

### 9.2 各版本对比

| 版本 | 单章 token 消耗 | 主要增量来源 |
|---|---|---|
| v1.7 | ~120K | 语义预检 + 灵感路由器（沿用摊销）+ 用户编辑辅助（沿用摊销） |
| v1.8 | ~120K | 与 v1.7 基本持平（工作台是 UI 工作） |
| v1.9 | ~120K | 仅灵感路由器真正运行；编排后端零 LLM 增量 |


## 十、风险评估与缓解

| 风险 | 严重度 | 缓解措施 |
|---|---|---|
| **AutopilotSession 持久化崩溃恢复** | 🔴 高 | 每次状态转换 write-through；启动时校验 `last_heartbeat_at`，超过 30s 标 stale；崩溃恢复自动从 `current_task` 继续或回退到上一 checkpoint |
| **SSE 大规模订阅者性能** | 🟡 中 | 单项目订阅者数 ≤ 3（典型多 tab）；`asyncio.Queue` 扇出；backpressure：慢消费者 → 服务端降级为广播但记录到 history 等待下次连接拉 |
| **灵感路由器噪音过多** | 🟢 低（已沿用 v1.7 缓解） | 用户可在 Settings 配置灵敏度 + 标记无效 + 双标签待确认 |
| **ContextPanel 挂载真组件引入 Stage1–3 页的回归风险** | 🟡 中 | 不复制组件，从原页面 import；保留 Stage1–3 页面单测不变；ContextPanel 仅切换"内联模式" wrapper |
| **Wizard 跳 `/workspace` 后用户迷惑（不知下一步做什么）** | 🟢 低 | WorkspaceTopBar 已显示"启动托管"按钮 + 进度环 0/N，零状态用户也能直觉下一步 |
| **BookShelf stat() 性能（249 项目）** | 🟢 低 | `os.scandir` 一次完成；实测 < 50ms |
| **前端 SSE 库选择** | 🟢 低 | 不引第三方；用浏览器原生 `EventSource` + `useEffect` cleanup |
| **AutopilotSession 单项目单实例约束** | 🟡 中 | 同一 project_id 同时只能有一个 session；start 时如果已有非 stopped session 直接复用；这样多 tab 共享同一会话 |
| **灵感路由器分类器对真实业务讨论的精度不足** | 🟡 中 | 沿用 v1.7 spec 的双标签/待确认机制；提供用户纠错 → 不追求 100% 自动正确 |
| **现有 v1.8 测试对 mock 状态强依赖** | 🟡 中 | v1.9 改造 WorkspacePage 后，需要重新整理 Workspace.test.tsx 的 mock 策略；Session 相关测试改为 mock API endpoint 而不是 mock useState |


## 十一、迭代计划（v1.9 内部阶段）

### 阶段 0：v1.8.1 polish（1 周，可并行于 v1.9 设计收尾）

- F1.8.1.1 后端 `updated_at` 字段扩展 + HomePage 传 mtimes
- F1.8.1.2 WizardContext prefill 回归测试（无生产代码改动，见 §三 F1.8.1.2 说明）
- F1.8.1.3 ContextPanel 6 tab 抽组件 + 挂载
- F1.8.1.4 Wizard finish 跳 workspace ✅ **已实现；阶段 0 仅做回归验证**
- F1.8.1.5 BookShelfModal STAGE5/6 链接
- 提交独立 PR；不阻塞后续工作

### 阶段 1：AutopilotSession 后端骨架（2 周）

- 数据模型 + 状态机 + 持久化 + 单元测试
- REST endpoints（除 SSE）+ 后端测试
- 与现有 Conductor / StageStateMachine 集成，单测覆盖"跑一个完整 chapter"

### 阶段 2：SSE + 前端接入（2 周）

- `SSEBroadcaster` + 协议细节（Last-Event-ID / 心跳 / 断线重连）
- `useAutopilotSession` hook
- ManagedDashboard / ManagedAIControlPanel / ManagedStartModal / WorkspaceTopBar / ModeSwitchConfirmModal 全部改 hook
- 集成测试：端到端启停 session + 看到 SSE 事件流

### 阶段 3：灵感路由器（2 周）

- `backend/inspiration/` 模块 + API
- `frontend/src/api/inspiration.ts` + InspirationPanel + SettingsPage 集成
- 触发点接入（各 Agent discussion 调 router）
- 验收测试 AC-9（10 轮讨论捕捉 ≥ 3 条）

### 阶段 4：补 AC-3 + 收尾（1 周）

- F1.9.8 NoveltyEvaluator 可复现性测试 AC-10
- `useWorkspaceMode` / `useWorkspacePanel` 服务端持久化（如果时间允许）
- 端到端集成测试
- 文档更新：CLAUDE.md 把 ⚠️ AC-3 改为 ✅；AC-8 改为 ✅


## 十二、与现有文档的关系

- 本文档**不替代** v1.7 spec/v1.7 TRD；那是已经实现并生效的版本规格。
- v1.8 系列（home-page / init-wizard / project-workspace）plan 中的"Open questions / follow-up / wired to backend / 内联编辑面板待 v1.8.1 接入"段落全部在此文档中给出归宿：
  - v1.8.1 段共 5 项（其中 F1.8.1.4 "wizard finish 跳 workspace" 实际已实现，本节保留作为反向验证占位）
  - v1.9 段共 8 项：
    - §四 编排后端主线 4 项：F1.9.1 AutopilotSession / F1.9.2 SSE 事件流 / F1.9.3 Modal 前端封装 / F1.9.4 进度环
    - §四 次要 1 项：F1.9.5 mode/panel 服务端持久化（不阻塞，可推迟到 v1.9.x）
    - §五 灵感路由器 2 项：F1.9.6 路由器主体 / F1.9.7 Idea Pool 跨项目口子（补 v1.7 AC-8）
    - §六 NoveltyEvaluator 可复现性 1 项：F1.9.8（补 v1.7 AC-3）
- 本文档**不展开** v1.9.x / v1.10 范围（跨项目资产复用、协作疲劳感知、叙事重构、Mid-Scene 缓存、多格式导出等 v1.7 §十展望项）；那些等 v1.9 完成后另起 spec。

---

> 文档基于以下源码与 plan 文件草拟：
> - `frontend/src/components/workspace/*`（11 个组件，含 v1.8 mock 注释）
> - `frontend/src/pages/WorkspacePage.tsx`
> - `frontend/src/components/wizard/InitWizardModal.tsx`
> - `frontend/src/components/wizard/WizardContext.tsx`
> - `backend/conductor/state_machine.py`、`backend/api/conductor.py`
> - plan: `2026-07-09-v1.8-home-page.md`、`2026-07-09-v1.8-init-wizard.md`、`2026-07-11-v1.8-project-workspace.md`
> - spec: `storyForge-design-v1.7.md`（F1.7.7 / F1.7.1 / AC-8 / AC-3）、`storyForge-design-v1.7-TRD.md`（路由结构参考）
