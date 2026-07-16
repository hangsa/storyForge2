# 托管模式对比分析报告 — storyForge2 vs plotPilot

> 对比日期: 2026/07/15
> 对比对象:
> - storyForge2: `/Users/longsa/Codes/storyForge2` (本项目,基于当前 v1.9 分支)
> - plotPilot: `/Users/longsa/Codes/plotPilot` (对比项目)

## 一、核心结论(一句话)

**plotPilot 把托管模式实现为"同一页面内中间栏的局部切换",左/右栏在托管与手动模式下完全一致;storyForge2 把托管/手动实现为"整页三栏各自独立切换",左/中/右三栏在两种模式下是不同的组件。** 这是两个项目托管模式最显著、最根本的差异,由此引发后端进程模型、SSE 端点数量、写作流体验等一系列连锁差异。

---

## 二、布局架构对比

### plotPilot — "共享外壳 + 中心切换"

| 栏位 | 托管模式 | 手动模式 | 是否一致 |
|---|---|---|---|
| 左栏 | `ChapterList.vue` (章节列表 / 部-卷-幕-章树) | 同左 | 完全相同 |
| 中栏 | `AutopilotWorkspace` (4 个面板: 驾驶舱/总编辑/仪表盘/监控·DAG) | `ChapterWorkbenchShell` (章节编辑器 + 本章舞台) | 完全不同 |
| 右栏 | `SettingsPanel` (叙事简报/当前语境/伏笔账本/故事演进/角色/道具/时间线...) | 同左 | 完全相同 |

实现要点:
- 单一路由 `/book/:slug/workbench`
- 中栏用 `<n-switch v-model="workMode">` (`WorkArea.vue:8-18`) 在 assisted/managed 之间切换
- 使用 `v-show` 而非 `v-if` 保留 SSE 连接 (`WorkArea.vue:22-26` 注释解释)
- 托管子面板内部 4 个 Tab, 核心是常驻挂载的 `AutopilotPanel` 保持写作 SSE 长连接

### storyForge2 — "三栏各自独立切换"

| 栏位 | 托管模式 | 手动模式 | 是否一致 |
|---|---|---|---|
| 左栏 | `ManagedDashboard.tsx` (章节状态网格 + 启停开关) | `ChapterTreePanel.tsx` (分卷的章节树) | 不同 |
| 中栏 | `AutopilotMiddlePanel.tsx` (3 个 Tab: 驾驶舱/仪表盘/监控日志) | `WritingArea.tsx` (大纲 + 文本编辑器) | 不同 |
| 右栏 | `ManagedAIControlPanel.tsx` (4 个 Tab: 决策流/队列/检查/干预) | `ContextPanel.tsx` (常规上下文/工具) | 不同 |

实现要点:
- 单一页面 `WorkspacePage.tsx` + URL `?mode=` + localStorage 双轨存储模式
- `WorkspaceLayout.tsx:64-277` 提供带可拖拽分隔条的三栏骨架, 但栏内组件由 `mode` 完全决定
- 托管中栏只有 3 个 Tab, 无总编辑/治理面板, 也没有实时写作流的中栏镜像
- 切换时托管→手动会触发 `stopAutopilotSession()` (`WorkspacePage.tsx:357-365`), 手动→托管会打开 `ManagedStartModal` 配置启动参数

---

## 三、后端架构差异

### plotPilot — 独立 OS 子进程 + 5 个 SSE 端点

| 维度 | 实现 |
|---|---|
| 进程模型 | `interfaces/daemon_manager.py:117-224` 用子进程拉起 `run_autopilot_daemon_process` |
| 共享状态 | 跨进程共享字典 `shared_state_repository.inject_shared_dict` |
| 状态机 | 小说级 5 阶段: `MACRO_PLANNING / ACT_PLANNING / WRITING / AUDITING / PAUSED_FOR_REVIEW` (`novel_lifecycle.py:25-123`) |
| SSE 端点 | 5 个独立端点: status, log-stream, chapter-stream, events, dag (`autopilot_routes.py:1891-2580`) |
| 线程隔离 | `_SSE_THREAD_POOL` 防止 DB/IO 阻塞 asyncio |
| 章节流 | 独立的 `/{novel_id}/chapter-stream` 推送章节文本块 |
| 恢复策略 | tick 入口 `AutopilotRecoveryPolicy` (`novel_lifecycle.py:28-65`) + `consecutive_error_count` |
| 默认模式 | `managed` (`WorkArea.vue:925,953`) |

### storyForge2 — 进程内 asyncio task + 1 个 SSE 端点

| 维度 | 实现 |
|---|---|
| 进程模型 | `AutopilotLoopService._tasks[project_id]` (`autopilot_loop.py:73-189`) 单进程内每项目一个 asyncio 任务 |
| 共享状态 | 进程内字典 + `<project>/autopilot/session.json` 写穿 (`autopilot_session.py:80-87`) |
| 状态机 | 项目级 8 阶段 (`INIT/STAGE1-6/COMPLETED`), 托管运行只触发 STAGE4 内的场景写作 |
| SSE 端点 | 1 个: `/session/events` (`autopilot.py:188`), 其它用 REST |
| 心跳 | 每次循环 `mgr.heartbeat()` (`autopilot_runner_async.py:145`), 30 秒无心跳即视为僵死 |
| 恢复策略 | 启动时 `recover_running_sessions()` (`autopilot_loop.py:123-189`) — 心跳缺失或超 30s 自动 pause |
| 默认模式 | `manual` (`useWorkspaceMode.ts`) |

---

## 四、关键差异维度对照表

| 维度 | plotPilot 托管模式 | storyForge2 托管模式 |
|---|---|---|
| **三栏布局策略** | 左/右栏共享, 只切中栏 | 三栏各自独立切换 |
| **后端进程模型** | OS 子进程 | 进程内 asyncio task |
| **实时通信端点数量** | 5 个 SSE (独立流分通道) | 1 个 SSE + REST |
| **写作流是否常驻 UI** | 是 (`AutopilotWritingStream` 永久挂载) | 否 (中栏仅显示任务状态, 不镜像实时文本) |
| **章节流独立端点** | 有 (`/{novel_id}/chapter-stream`) | 无 |
| **持久化策略** | 跨进程共享字典 + DB | 单进程 + `<project>/autopilot/session.json` |
| **状态机粒度** | 小说级 5 阶段 | 项目级 8 阶段, 托管范围只覆盖 STAGE4 内部 |
| **恢复机制** | tick 入口 `RecoveryPolicy` + 错误计数 | 心跳超时 (30s) → 自动降级 |
| **托管面板丰富度** | 4 个 Tab (驾驶舱/总编辑/仪表盘/监控·DAG) | 3 个 Tab (驾驶舱/仪表盘/监控日志) |
| **是否有 DAG 可视化** | 有 (`AutopilotDAGView.vue`) | 无 |
| **是否有治理面板** | 有 (`NarrativeGovernanceCockpit.vue`) | 无 (分散在右栏的"检查/干预"Tab) |
| **切换时的副作用** | 直接切, 无 stop (托管默认开着) | 托管→手动停止 session; 手动→托管弹配置对话框 |
| **默认模式** | `managed` | `manual` |
| **跨进程/进程隔离** | 子进程边界 + 共享字典 | 纯 asyncio 协作 |

---

## 五、最显著差异的深层解读

### 5.1 布局策略差异背后的产品定位

plotPilot 把"托管"当作**默认工作方式**, 所以设计上尽量减少切换摩擦 — 左右栏的常规导航/参考信息不因托管而消失, 用户随时能看到自己的章节结构和叙事状态。

storyForge2 把"托管"当作**进阶功能** (默认手动), 所以托管模式是另一种完整的"AI 控制台"体验, 左中右三栏都被重新组织为更接近"AI 控制台"的形态 (驾驶舱、决策流、队列、干预), 与手动写作的"编辑器 + 大纲 + 上下文"是平行而非叠加的关系。

### 5.2 后端进程模型的工程权衡

plotPilot 选子进程, 意味着托管引擎**可以独立崩溃而不影响 API 服务**, 可以独立部署/水平扩展; 但代价是必须维护跨进程状态同步 (`shared_state` 字典) 与多 SSE 端点的并发控制。

storyForge2 选进程内 asyncio task, 简单、状态在内存、调试方便; 但 API 进程崩溃即托管崩溃 — 所以才有"心跳降级"机制专门处理这种情况。

### 5.3 写作流体验的差距

plotPilot 中栏驾驶舱**实时镜像章节文本生成流** (`AutopilotWritingStream` 永久挂载, 切 Tab 不丢), 用户能"看着 AI 一行一行写"。这是托管模式的核心体验。

storyForge2 中栏驾驶舱**只显示任务描述、事件流、队列**, 实际写作文本只能在手动模式的 `WritingArea` 看到。换言之托管模式下用户**看不到 AI 当前写到哪一句**, 只能看到进度事件。

### 5.4 状态机粒度差异

plotPilot 托管引擎驱动整本小说的**全生命周期** (从宏观规划到分幕规划到写作到审计), 状态机在小说级。

storyForge2 托管只驱动**章节内的场景写作循环** (STAGE4 内的 scene-by-scene 写作 + Fact Guard + StoryOS 更新), 前期 STAGE1-3 与后期 STAGE5-6 都不在托管范围内。托管是"写作阶段的加速器", 不是"全流程自动化"。

---

## 六、若对齐 plotPilot 设计的可考虑方向

如果想让 storyForge2 托管体验更接近 plotPilot, 可考虑:

1. **共享外壳**: 让左栏 `ChapterTreePanel` 与右栏 `ContextPanel` 的核心信息在托管模式下仍可见 (只附加状态徽标), 而不完全替换 — 降低托管模式的学习成本。
2. **实时写作流镜像**: 在 `AutopilotMiddlePanel` 的驾驶舱 Tab 里常驻挂载一个写作流组件 (类似 `AutopilotWritingStream`), 通过单独的章节 SSE 流推送。
3. **DAG / 治理面板**: 把当前的"决策流/队列/检查"在视觉上聚合成 plotPilot 的"总编辑 + 仪表盘", 提供更宏观的视图。
4. **默认模式**: 视产品决策是否要让托管成为默认入口。

但这些都需要权衡 storyForge2 当前"托管=AI 控制台、手动=编辑器"的对称设计是否有更高价值。

---

## 七、关键文件索引

### storyForge2

| 类别 | 文件 |
|---|---|
| 托管页面入口 | `frontend/src/pages/WorkspacePage.tsx` (100-628) |
| 三栏布局骨架 | `frontend/src/components/workspace/WorkspaceLayout.tsx` (64-277) |
| 顶栏 + 模式开关 | `frontend/src/components/workspace/WorkspaceTopBar.tsx` (30-131) |
| 模式切换控件 | `frontend/src/components/workspace/WorkspaceModeSwitcher.tsx` (13-35) |
| 模式状态 (URL+localStorage) | `frontend/src/hooks/useWorkspaceMode.ts` (12-49) |
| 托管中栏 (驾驶舱/仪表盘/日志) | `frontend/src/components/workspace/AutopilotMiddlePanel.tsx` (57-138, 153-277) |
| 托管左栏 (状态网格) | `frontend/src/components/workspace/ManagedDashboard.tsx` (35-112) |
| 托管右栏 (AI 控制) | `frontend/src/components/workspace/ManagedAIControlPanel.tsx` (16-136) |
| SSE 订阅 hook | `frontend/src/hooks/useAutopilotSession.ts` (29-110) |
| EventSource 封装 | `frontend/src/api/autopilot.ts` (39-72) |
| 切换确认弹窗 | `frontend/src/components/workspace/ModeSwitchConfirmModal.tsx` (21-80) |
| 启动配置弹窗 | `frontend/src/components/workspace/ManagedStartModal.tsx` (18-80) |
| REST + SSE 路由 | `backend/api/autopilot.py` (64-220) |
| SSE 广播器 | `backend/utils/sse_broadcaster.py` (33-114) |
| 项目级 asyncio 服务 | `backend/conductor/autopilot_loop.py` (73-189) |
| 心跳降级恢复 | `backend/conductor/autopilot_loop.py` (123-189) |
| 异步 runner + 心跳 | `backend/conductor/autopilot_runner_async.py` (118-188) |
| Session 管理器 (写穿) | `backend/conductor/autopilot_session.py` (31-256) |
| 心跳写穿 | `backend/conductor/autopilot_session.py` (207-218) |
| STAGE4 异步执行器 | `backend/conductor/stage4_async_executor.py` (1-99) |
| Session 数据模型 | `backend/models/autopilot_session.py` (1-80) |

### plotPilot

| 类别 | 文件 |
|---|---|
| 单一路由页面 | `frontend/src/views/Workbench.vue` (7-69) |
| 中栏切换器 | `frontend/src/components/workbench/WorkArea.vue` (8-18, 27-316, 319-330, 925-953) |
| 托管中栏壳 | `frontend/src/components/autopilot/AutopilotWorkspace.vue` (1-56) |
| 驾驶舱 (含写作流) | `frontend/src/components/autopilot/AutopilotPanel.vue` (1-156, 158, 225-226, 515, 548, 638) |
| 左栏 (章节列表) | `frontend/src/components/workbench/ChapterList.vue` (1-95) |
| 右栏 (通用设置) | `frontend/src/components/workbench/SettingsPanel.vue` (1-80) |
| 托管 Tab 状态 | `frontend/src/stores/autopilotWorkspaceStore.ts` (42-75) |
| 监控/DAG 视图 | `frontend/src/components/autopilot/AutopilotOperationsView.vue` |
| 跨进程守护进程 | `interfaces/daemon_manager.py` (117-224, 351-450) |
| 守护进程组装 | `scripts/start_daemon.py` (66-130) |
| 守护进程类 | `application/engine/services/autopilot_daemon.py` (20, 80-83) |
| 小说级状态机 | `engine/runtime/novel_lifecycle.py` (25-123) |
| 全部 REST + SSE 路由 | `interfaces/api/v1/engine/autopilot_routes.py` (10, 436, 1047-1050, 1245, 1378, 1566, 1671, 1891-2580, 278-281) |
| 前端 API 客户端 | `frontend/src/api/autopilot.ts` (38-81) |
| 手动模式状态订阅 | `frontend/src/workbench/useAssistedAutopilotStatus.ts` |