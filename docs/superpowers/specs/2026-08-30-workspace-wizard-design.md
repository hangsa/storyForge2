# Workspace Wizard 设计 Spec

> 把 `InitWizardModal` 的 6 步引导**融合**进 `/project/:id/workspace`，使 Workspace 成为唯一的项目入口。
> 设计图：[/docs/design/workspace-wizard/](../design/workspace-wizard/)。
> 参考现状：[/docs/wizard-inventory.md](../../wizard-inventory.md)。

---

## 1. 背景与目标

当前 Workspace 与 Wizard 是两套并列 UI：Workspace 自带 chrome（topbar + 三栏），Wizard 是 `fixed inset-0` 全屏 overlay 弹窗。两者编辑同一批 JSON 文件（`concept_and_dna.json` / `world.json` / `characters.json` / `novel_outline.json` / `outline.json`），用户需要来回切换。

设计目标：
1. 把 Wizard 从 transient overlay 提升为 Workspace 内部的 permanent view。
2. 引入 `项目设定` / `正文手稿` 顶层 tab，明确两个工作区的边界。
3. 新增 `创意发散` 作为 wizard 第 1 步，承载 `backend/creative_os/` 的能力，输出候选概念，预填 `概念 DNA`。
4. 消除 ContextPanel 右栏 1-5 编辑器与 wizard 的双 UI 冗余。
5. 不破坏现有 wizard 状态机的边界情况处理（断点续生成、STEP_DATA_KEY_TO_STEP 清空下游、prefill 等已稳定的 v1.8.2 ~ v2.x 逻辑）。

不在本次范围：地图系统的实际功能（保持占位）、manual/managed 模式重构、写作侧体验改动。

---

## 2. 顶层结构

```
WorkspacePage
├── WorkspaceTopBar (重写,新增 tab 切换)
│   ├── 左侧: project name + mode switcher (manual/managed) — 现有
│   ├── 中部: Tab 切换
│   │   ├── "项目设定" → 落地 WorkspaceWizardPanel
│   │   └── "正文手稿" → 落地 WorkspaceWritingPanel
│   │       (locked until allStepsDone)
│   └── 右侧: 现有 settings / history / AI 工具 / person icon
└── <WorkspaceModePanel> (随 activeTab 切换)
    ├── if tab=settings → <WorkspaceWizardPanel>
    │   ├── <WizardSidebar> (7 items, 240px 纵向 sticky)
    │   └── <WizardCanvas> (host currentStep 组件 + footer)
    │       └── wrapped in <WizardProvider> (复用现有 WizardContext)
    └── if tab=manuscript → <WorkspaceWritingPanel>
        ├── 三栏: <ChapterTreePanel> | <WritingArea> | <ContextPanel>
        └── 现有 modals: ModeSwitchConfirmModal / ManagedStartModal / AddChaptersModal / PromptPlazaModal / AIConsoleModal / ConfirmDialog
```

**不变量**：
- `WizardProvider` + `WizardContext` 零改动。
- 现有 6 个 step 组件（ConceptStep / WorldStep / CharacterStep / MapStep / OutlineStep / ChapterOutlineStep）零改动 drop-in 进 canvas。
- `TOTAL_STEPS` 从 6 改成 7；`STEP_DATA_KEY_TO_STEP` 把现有 step 1..6 全部 +1，新增 `creative_divergence → 1`。
- `InitWizardModal.tsx` 文件保留，标 DEPRECATED，不再被任何 active route 引用。
- `WizardDeepLinkPage` 改为 redirect shell。

---

## 3. 组件设计

### 3.1 新增组件

#### `<WorkspaceTopBar>` — 重写 `frontend/src/components/workspace/WorkspaceTopBar.tsx`

保留 props：`projectId`, `projectName`, `mode`, `onModeChange`, `onOpenPlaza`, `onOpenConsole`。
新增 props：`activeTab: "settings" | "manuscript"`, `onTabChange: (t) => void`, `manuscriptLocked: boolean`。

视觉：
- 左侧（project name + mode switcher）保持现有。
- 中部新增两个 tab button：
  - active：`text-primary border-b-2 border-primary py-1`
  - inactive：`text-on-surface-variant hover:text-on-surface transition-colors`
  - locked（manuscript 未完成）：`disabled` + `opacity-50` + tooltip "完成所有项目设定后可进入正文手稿"。

#### `<WorkspaceWizardPanel>` — 新文件 `frontend/src/components/wizard/WorkspaceWizardPanel.tsx`

```tsx
interface WorkspaceWizardPanelProps {
  projectId: string;
  reloadKey?: number;
  onReload?: () => void;
}
```

- 内部包 `<WizardProvider projectId={projectId}>`，与 `InitWizardModal` 同一 provider。
- 渲染 `<WizardSidebar>` + `<WizardCanvas>` 两栏 flex 布局（左 240px sidebar，右 1fr canvas，gap 0，min-height `calc(100vh - 64px)`）。
- canvas 顶部 toolbar 显示当前 step 标题（"初始化向导 · {STEP_TITLES[currentStep]}"）+ 右侧 footer 按钮 row（上一步 / 重新生成 / 保存修改 / 确认修改并继续）。
- footer 复用 `<RegenerateStatusBadge>`（从 `InitWizardModal.tsx` 抽出到独立文件 `frontend/src/components/wizard/RegenerateStatusBadge.tsx` 复用）。
- prefill useEffect：并发拉取 6 个文件（新增 `getCreativeDivergence`），沿用 InitWizardModal 的 `hasContent` 判定。
- 不再调 `api.advance(projectId, "STAGE4")`——advance 改为由 WorkspacePage 在 manuscript tab 激活时触发。

#### `<WizardSidebar>` — 新文件 `frontend/src/components/wizard/WizardSidebar.tsx`

```tsx
interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (step: number) => void;
}
```

- 把现有 `<WizardSteps>` 6-button 横向 row 改成 7-item 纵向 sidebar。
- 数据源（`STEP_LABELS` 改为 7 项 + Material Symbols icon）：
  ```
  1 → "创意发散"   (psychology)
  2 → "概念 DNA"   (biotech)
  3 → "世界观"     (public)
  4 → "角色设计"   (groups)
  5 → "地图系统"   (map)
  6 → "全文大纲"   (format_list_numbered)
  7 → "章节大纲"   (auto_stories)
  ```
- Active 样式照搬设计文档：
  ```
  flex items-center gap-sm px-md py-xs
  bg-secondary-container text-on-secondary-container
  rounded-lg font-bold scale-95 transition-transform duration-150
  ```
- Inactive：`text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors duration-200`。
- Completed：active 样式 + 右侧 `✓` icon。
- Pending：`opacity-50` + `cursor-not-allowed`。
- sticky：`sticky top-16`（topbar 64px 之下）。

#### `<CreativeDivergenceStep>` — 新文件 `frontend/src/components/wizard/CreativeDivergenceStep.tsx`

视觉照搬设计文档 `screen.png`：
- header：`font-display-lg text-display-lg text-on-surface "创意发散"` + subtitle "为你的叙事生成主题钩子和概念起点。"
- Glass panel 输入区（`glass-panel rounded-xl p-md`）：
  - label：`font-label-sm text-label-sm text-primary uppercase tracking-wider "AI 提示词指令"`（含返回箭头 icon `arrow_back_ios_new`）
  - textarea：`w-full bg-surface-container-high border border-outline-variant rounded-lg p-sm min-h-[120px]`，placeholder "描述你的故事想法的核心本质、主题或背景...例如，'一个赛博朋克侦探在水下城市调查记忆盗窃。'"
  - 底部 row：左两个 ghost button（`参数设置` 含 tune icon / `语气：惊悚` 含 style icon），右主 button（`bg-primary text-on-primary "生成概念 →"` 含 arrow_forward icon + `hover:bg-primary-container` + `shadow-[0_0_15px_rgba(142,213,255,0.3)]`）。
- 变体 section header：`flex items-center justify-between border-b border-outline-variant pb-sm` + `font-title-md text-title-md "生成的创意方向"`（含 auto_awesome icon）+ 右侧 count `font-label-sm text-label-sm text-on-surface-variant "已有 N 个变体"`。
- 变体 grid：`grid grid-cols-1 md:grid-cols-2 gap-md`，每张 card：
  - 玻璃面板背景：`glass-panel rounded-xl p-md`
  - 第一张 active：`border-primary/50 glow-active` + `bg-primary/20 text-primary` 角标 "概念 ALPHA"
  - 其他：`border-outline-variant` + `hover:border-primary/50` + `bg-surface-container-high` 角标 "概念 BETA" / GAMMA / DELTA
  - hover 时显示 thumb_up + content_copy icon 按钮组
  - 标题 `font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-xs`
  - 描述 `font-body-sm text-on-surface-variant line-clamp-3`
  - 底部 tag row `flex flex-wrap gap-2`，每个 tag `px-2 py-1 bg-surface-container text-on-surface-variant rounded text-[10px] font-label-sm border border-outline-variant`

交互：
- mount → `api.listCreativeDivergenceVariants(projectId)`；空时显示 placeholder "点生成开始创意发散"。
- 用户输入 prompt + 选 tone → `api.generateCreativeDivergenceVariants(projectId, {prompt, count: 4, tone, genre_tags})` → 后端写 `creative_divergence.json` → 返回 variants。
- 选中变体（点 card）：setSelectedVariantId(id)，footer 出现"确认选中并继续"按钮。
- 确认 → `api.selectCreativeDivergenceVariant(projectId, variant_id)` → 后端写 `concept_and_dna.json.concept.{title, genre, premise, tone, theme}`（不写 story_dna）+ 更新 `creative_divergence.json.selected_id` → 返回 concept payload → `wizard.markStepGenerated(1, { creative_divergence: <variants>, concept: <payload> })` + `wizard.jumpToStep(2)`。
- footer 同时支持 "上一步"（disabled at step=1）与 "保存修改"（persist 当前 textarea 与 selected_id）。

#### `<WorkspaceWritingPanel>` — 新文件 `frontend/src/components/workspace/WorkspaceWritingPanel.tsx`

- 把当前 `WorkspacePage` 中 manuscript 相关 props + state + 副作用全部搬过来：currentChapter / currentScene / sceneStatus / volumeGroups / chapterStatus / reloadKey / content / lastSavedContent / mode / 全部 modals。
- 接收 props：`projectId`, `projectName`, `mode`, `setMode`, `initialChapter?: number, initialScene?: string`。
- 内部 hold 自己 reloadKey，与 WorkspaceWizardPanel 独立。
- URL `?chapter=N&scene=M` 同步（沿用现有逻辑）。

### 3.2 修改组件

#### `<ContextPanel>` (`frontend/src/components/workspace/ContextPanel.tsx`)

- 删除 5 个 editor tab：概念 / 世界观 / 角色 / 大纲 / 章节大纲。
- 保留：诊断 / 导出。
- 文件预计从 ~154 行降到 ~80 行。
- props 删 `readOnly` / `readOnlyReason`：由 `<WorkspaceWritingPanel>` 默认传入 `readOnly={mode === "managed"}`。

#### `<WizardSteps>` (`frontend/src/components/wizard/WizardSteps.tsx`)

- 文件保留作为 legacy reference，顶部加 `// DEPRECATED — replaced by <WizardSidebar>.`。
- `InitWizardModal.tsx` 不再 import 它。

#### `<RegenerateStatusBadge>` — 从 InitWizardModal.tsx 抽出

- 新文件 `frontend/src/components/wizard/RegenerateStatusBadge.tsx`，原 inline 定义直接搬过来。
- `InitWizardModal.tsx` 与 `WorkspaceWizardPanel.tsx` 都 import 之。

### 3.3 删除 / 重定向

#### `WizardDeepLinkPage` (`frontend/src/pages/WizardDeepLinkPage.tsx`)

24 行整个替换为 redirect shell：

```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function WizardDeepLinkPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (projectId) {
      navigate(
        `/project/${encodeURIComponent(projectId)}/workspace?tab=settings`,
        { replace: true }
      );
    }
  }, [projectId, navigate]);
  return null;
}
```

#### `InitWizardModal` (`frontend/src/components/wizard/InitWizardModal.tsx`)

- 文件保留作为 fallback 引用。
- 文件顶部加 `// DEPRECATED — replaced by <WorkspaceWizardPanel>. Kept for backward-compatible imports in legacy code.`。
- 不被任何 active route 引用。

---

## 4. 数据流

### 4.1 State 划分

```
WorkspacePage (顶层)
├── activeTab: "settings" | "manuscript"
│   └── 派生: allStepsDone = wizard.completedSteps.length === 7
├── manuscriptLocked: !allStepsDone
└── 持有跨 tab 共享 state:
    ├── projectName (从 api.getProjectStatus)
    └── reloadKey (ContextPanel save 后会 ++)

WorkspaceWizardPanel
└── WizardProvider (项目级)
    ├── wizard: WizardState (currentStep, completedSteps, status, data, ...)
    ├── sessionStorage 持久化 key: storyforge.wizard.state.<projectId>
    ├── prefill useEffect: 并发拉取 6 个 JSON
    │   ├── getCreativeDivergence (creative_divergence.json) → step 1
    │   ├── getConcept (concept_and_dna.json) → step 2
    │   ├── getWorld (world.json) → step 3
    │   ├── getCharacter (characters.json) → step 4
    │   ├── getNovelOutline (novel_outline.json) → step 6
    │   └── getOutline (outline.json) → step 7
    └── step 渲染:
        ├── step=1 → <CreativeDivergenceStep>
        ├── step=2 → <ConceptStep>
        ├── step=3 → <WorldStep>
        ├── step=4 → <CharacterStep>
        ├── step=5 → <MapStep> (placeholder)
        ├── step=6 → <OutlineStep>
        └── step=7 → <ChapterOutlineStep>

WorkspaceWritingPanel (manuscript tab)
├── 持有所有现有 WorkspacePage 的写作相关 state:
│   ├── chapters, manualChapters, novelOutline
│   ├── currentChapter, currentScene, sceneStatus, chapterStatus
│   ├── content, lastSavedContent, busy
│   └── initPreview, confirmOpen, startOpen, plazaOpen, consoleOpen, addOpen, addProgress
├── URL ?chapter=N&scene=M 同步 (沿用现有逻辑)
└── 加载 useEffect: getOutline / getStage4Progress / getNovelOutline / getSceneDraft / getProjectStatus
```

### 4.2 创意发散 → 概念 DNA 预填

```
1. CreativeDivergenceStep 挂载
   → api.listCreativeDivergenceVariants(projectId)
2. 用户输入 prompt → api.generateCreativeDivergenceVariants(projectId, prompt)
   → 后端调 creative_os.mutation_engine + idea_pool + trope_pool
   → 写入 creative_divergence.json.variants[]
   → 返回 variants
3. 渲染 variant cards grid
4. 用户点 card → setSelectedVariantId(id)
5. footer "确认选中并继续":
   ├── api.selectCreativeDivergenceVariant(projectId, id)
   │   → 后端取 selected variant 的 {title, genre, premise, tone, theme}
   │   → 写入 concept_and_dna.json.concept (不写 story_dna)
   │   → 写 creative_divergence.json.selected_id + selected_at
   │   → 返回 concept_and_dna.json 内容
   └── wizard.markStepGenerated(1, { creative_divergence: <variants>, concept: <payload> })
       + wizard.jumpToStep(2)
6. ConceptStep 挂载 → useEffect 读 wizard.data.concept
   ├── 若存在且 concept.source === "creative_divergence"
   │   → 字段灰显 + 顶部 banner "由创意发散自动生成，可手动修改"
   └── 用户编辑覆盖后 source 标为 "manual"
7. 用户编辑 + 确认 → api.updateConcept(...) → 写回 story_dna 与更新过的 concept
```

### 4.3 文件 Schema 新增

`projects/<id>/creative_divergence.json`：

```json
{
  "prompt": "...",
  "variants": [
    {
      "id": "var_<uuid>",
      "label": "概念 ALPHA",
      "title": "风暴密码",
      "description": "...",
      "tags": ["科幻", "悬疑", "人与自然"],
      "created_at": "2026-08-30T..."
    }
  ],
  "selected_id": "var_xxx",
  "selected_at": "2026-08-30T...",
  "updated_at": "2026-08-30T..."
}
```

`projects/<id>/concept_and_dna.json` 改动：

```json
{
  "concept": {
    "title": "...",
    "genre": "...",
    "premise": "...",
    "tone": "...",
    "theme": "...",
    "source": "creative_divergence" | "manual",
    "source_variant_id": "var_xxx" | null
  },
  "story_dna": { ... }
}
```

`target_audience` / `style_template` 等其他字段保持原样，ConceptStep 编辑时 source 不变（仅核心 5 字段参与预填）。

### 4.4 Tab 锁定逻辑

```
allStepsDone = [1,2,3,4,5,6,7].every(s => wizard.completedSteps.includes(s))
manuscriptLocked = !allStepsDone
```

- WorkspaceTopBar：`disabled={manuscriptLocked}` on manuscript tab button。
- hover：tooltip "完成 7 步项目设定后可进入正文手稿"。
- 用户强行访问 `/workspace?tab=manuscript` 但 locked → WorkspacePage 自动 setActiveTab("settings")，不报错。

### 4.5 默认落地 tab

```
useEffect on mount:
  if (URL has ?tab) {
    const requested = URL param
    if (requested === "manuscript" && manuscriptLocked) setActiveTab("settings")
    else setActiveTab(requested)
  } else {
    if (allStepsDone) setActiveTab("manuscript")
    else setActiveTab("settings")
  }

用户主动切 tab 时:
  localStorage["storyforge.workspace.active-tab"] = activeTab
  （locked 时 manuscript 写入但不生效）
```

---

## 5. 后端 API

新增 `backend/api/creative_divergence.py`，挂载到 `backend/main.py`：

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/projects/{id}/creative-divergence` | — | `{variants: [...], selected_id: string\|null}` |
| POST | `/projects/{id}/creative-divergence/generate` | `{prompt: str, count?: int=4, params?: {tone, genre_tags}}` | `{variants: [...]}` (写入文件, 覆盖式) |
| POST | `/projects/{id}/creative-divergence/select` | `{variant_id: str}` | `{concept_payload: {title, genre, premise, tone, theme}}` (同时写 `concept_and_dna.json.concept` + `creative_divergence.json.selected_id`) |
| GET | `/projects/{id}/creative-divergence/prefill-check` | — | `{exists: bool, has_selection: bool}` (供 WizardContext prefill 决定 completedSteps) |

模型路由：Tier 1 (creative core) — 与现有 mutation_engine 一致。Provider 优先用 tier1 配置，缺 fallback 到 mock。

存储：每个项目目录 `projects/<id>/creative_divergence.json` — 与 `concept_and_dna.json` 同级。`file_manager` 走 `_file_manager()` 工厂（避免 `project_api_file_manager_pattern` 踩坑）。

校验：
- prompt 长度 1-2000；过长 422。
- variant_id 必须在已生成列表内；select 时不存在 422。
- generate 调用限流：单项目 1 次 / 5s（防滥用）。

`concept_and_dna.json.concept.source` 由 select 端点写入 `"creative_divergence"`；ConceptStep 的 updateConcept 端点（`backend/api/concept.py`）改为接受 `source` 字段，用户手动编辑时改为 `"manual"`。

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| WorkspaceTopBar manuscriptLocked 时点击 | 不响应；tooltip 已说明 |
| WorkspaceWizardPanel prefill 部分失败 | `Promise.allSettled` 全部失败 → `wizard.markPrefillComplete()` 让 auto-trigger 可走；任一成功 → hydrate 该 step |
| CreativeDivergenceStep.generate 5xx / 网络错 | footer error banner "生成失败：<msg>"，保留用户输入，已生成 variants 不清空 |
| CreativeDivergenceStep.generate 422 (prompt 过长) | inline 字段红色 + 提示"提示词过长（>2000 字）" |
| CreativeDivergenceStep.select 422 (variant 不存在) | error banner "该变体已不存在，请重新生成" |
| CreativeDivergenceStep.select 概念写入失败 | variant 仍标 selected；toast "概念预填失败，请到概念 DNA 步骤手动填写" |
| ContextPanel activeTab 越界（旧 index） | 默认落到 "诊断"；启动 useEffect 校验越界自动 fallback |
| reloadKey 跨 tab 一致性 | 项目设定 tab 内 save 触发的是 wizard 内部 reloadKey，不传染到 manuscript tab |
| /wizard 路由 deep link | `WizardDeepLinkPage` 立即 redirect `/workspace?tab=settings`；项目不存在由 WorkspacePage 404 处理（navigate("/")） |
| URL `?tab=manuscript` + locked | 强制 settings；不报错，dev console warning |
| 章节大纲 step 批量生成失败 | 由 ChapterOutlineStep 内部现有"重试 N 次 + 暂停继续 + footer 进度条"处理；新 shell 不变 |

---

## 7. 测试

### 7.1 Vitest

**现有覆盖（不破坏）**：
- `WizardContext.test.tsx` — provider 零修改，测试全部继续通过。
- `wizard-step-components/*.test.tsx` — ConceptStep / WorldStep / CharacterStep / OutlineStep / ChapterOutlineStep 等各自单测，host 无关。
- 当前 `WorkspacePage.test.tsx` 拆分为：
  - `WorkspacePage.test.tsx`（tab 切换 + 锁定 + 默认落地，约 80 行）
  - `WorkspaceWizardPanel.test.tsx`（prefill 6 文件 + 7 sidebar 项渲染 + advance 触发时机）
  - `WorkspaceWritingPanel.test.tsx`（现有行为下沉）

**新增**：

1. **WorkspaceTopBar 锁定逻辑**
   - allStepsDone=false → manuscript tab disabled + tooltip 文案
   - allStepsDone=true → manuscript tab enabled，切到 manuscript 触发 onTabChange
   - locked 时 click 不响应

2. **WorkspaceWizardPanel prefill（6 文件并发）**
   - 全部 6 文件缺失 → markPrefillComplete，currentStep=1
   - 创意发散文件存在但无选中 → completedSteps 含 1（仅 generate 过，无 select）
   - 创意发散文件存在且 selected + concept_and_dna.concept.source="creative_divergence" → completedSteps 含 1+2
   - 旧 5 文件存在 → 沿用现有 `hasContent` 判定 completedSteps 2..7

3. **WizardSidebar 视觉 / 交互**
   - 7 item 渲染顺序、label、icon 正确
   - active item 高亮 `bg-secondary-container` + ✓
   - pending item disabled
   - 点击 reachable item → onJump(step)

4. **CreativeDivergenceStep**
   - mount → 调 list；空列表显示 placeholder "点生成开始创意发散"
   - generate → spinner；成功渲染 4 张 variant cards
   - select → 调 select API + 触发 onNext（markStepGenerated + jumpToStep）
   - 失败 path：banner 显示，可重试
   - 创意发散预填 ConceptStep：source="creative_divergence" 时字段灰显 + banner

5. **default-tab 推导**
   - URL 无 + allStepsDone → manuscript
   - URL 无 + !allStepsDone → settings
   - URL `?tab=manuscript` + locked → 强制 settings
   - URL `?tab=settings` → 尊重 URL

6. **/wizard 路由**
   - 进入 `/project/:id/wizard` → navigate 到 `/workspace?tab=settings`（replace=true）

7. **ContextPanel 移除 5 editor tab**
   - 只剩"诊断" / "导出"两 tab
   - props `readOnly` 由 `WorkspaceWritingPanel` 默认传入

### 7.2 pytest (后端)

新增 `tests/test_creative_divergence_api.py`：
- generate 正常路径 → 写入文件，返回 4 variants
- generate prompt 过长 422
- generate 限流：1 次 / 5s 触发 429
- select 正常路径 → 写 `creative_divergence.json.selected_id` + `concept_and_dna.json.concept.source="creative_divergence"`
- select 不存在 variant_id 422
- prefill-check：exists=false / exists=true has_selection=false / exists=true has_selection=true
- 文件读写 round-trip：写入后 GET 读回一致

### 7.3 手动 smoke

```
1. HomePage 点 "建档并进入工作台" → 进 /workspace?tab=settings
2. 走完 7 步（创意发散 → 选中 → 概念 DNA → 世界观 → 角色 → 地图跳过 → 全文大纲 → 章节大纲）
3. 切到 manuscript tab → 出现现有写作三栏布局
4. /wizard 路由 → redirect 到 /workspace?tab=settings
5. 旧项目（stage > INIT）打开 → 默认 manuscript tab
6. INIT 阶段项目打开 → 默认 settings tab + manuscript tab disabled
```

---

## 8. 文件清单

### 新增

```
frontend/src/components/wizard/
├── WorkspaceWizardPanel.tsx        (~250 行)
├── WizardSidebar.tsx               (~120 行)
├── CreativeDivergenceStep.tsx      (~280 行)
└── RegenerateStatusBadge.tsx       (~70 行, 从 InitWizardModal 抽出)

frontend/src/components/workspace/
└── WorkspaceWritingPanel.tsx       (~600 行, 从 WorkspacePage 抽出)

backend/api/
└── creative_divergence.py          (~150 行)

tests/
├── test_creative_divergence_api.py
├── WorkspaceTopBar.test.tsx        (新增锁定逻辑测试)
├── WorkspaceWizardPanel.test.tsx   (新增)
├── WorkspaceWritingPanel.test.tsx    (新增, 行为下沉)
├── WizardSidebar.test.tsx          (新增)
└── CreativeDivergenceStep.test.tsx (新增)
```

### 修改

```
frontend/src/components/workspace/WorkspaceTopBar.tsx   (重写, +tab 切换)
frontend/src/components/workspace/ContextPanel.tsx      (删 5 editor tab)
frontend/src/components/wizard/WizardContext.tsx        (TOTAL_STEPS=7, STEP_DATA_KEY_TO_STEP +1, prefill +1)
frontend/src/components/wizard/WizardSteps.tsx          (标 DEPRECATED)
frontend/src/components/wizard/InitWizardModal.tsx      (标 DEPRECATED)
frontend/src/components/wizard/ConceptStep.tsx          (新增 prefill source 检测)
frontend/src/pages/WorkspacePage.tsx                    (瘦身到 ~150 行, 持有 tab state + reloadKey)
frontend/src/pages/WizardDeepLinkPage.tsx               (24 行 → redirect shell)
frontend/src/api/client.ts                              (+4 个 creative_divergence 方法)
backend/main.py                                         (挂载 creative_divergence router)
backend/api/concept.py                                  (update_concept 接受 source 字段)
```

### 删除

无文件删除；只删除 `InitWizardModal.tsx` 中不再使用的 `<WizardSteps>` import 与 `<RegenerateStatusBadge>` inline 定义。

---

## 9. 风险与回退

**风险**：
- ContextPanel 删 5 editor tab 是不可逆 UI 改动。若用户已习惯右栏编辑，需重新熟悉 sidebar。
- 创意发散新增 LLM 调用（Tier 1）可能拉长 wizard 首屏时间。
- 现有 wizard vitest 大量依赖 mock InitWizardModal，迁移到 WorkspaceWizardPanel 后需重新对齐测试 target。

**回退**：
- `InitWizardModal.tsx` 文件保留，所有内部组件代码不变 — 若 WorkspaceWizardPanel 出问题，5 分钟内可恢复 `/wizard` 路由使用 InitWizardModal（`WizardDeepLinkPage` 改为直接渲染 modal，不 redirect）。
- `ContextPanel` 删 5 editor tab 通过 git revert 一键回退。
- 后端 `creative_divergence` API 独立，无下游依赖，可独立 disable。

---

## 10. 验收标准

- [ ] 所有 7 个 sidebar item 可点击跳转；active 状态视觉照搬设计文档。
- [ ] 7 步全部走完后 manuscript tab 解锁；默认落地 manuscript。
- [ ] INIT 阶段项目打开 → 默认 settings tab；manuscript tab disabled。
- [ ] /wizard 路由访问 → 自动 redirect 到 /workspace?tab=settings。
- [ ] 创意发散 generate → 4 张 variant cards；select → concept_and_dna.concept 自动预填；ConceptStep 顶部 banner 显示来源。
- [ ] ContextPanel 只剩"诊断" / "导出"两 tab。
- [ ] 现有 wizard 断点续生成、章节大纲批量暂停继续、prefill、STEP_DATA_KEY_TO_STEP 等逻辑全部沿用，零回归。
- [ ] `npm test` + `pytest tests/test_wizard_*` + `pytest tests/test_creative_divergence_api.py` 全过。
- [ ] 手动 smoke 6 步全通过。