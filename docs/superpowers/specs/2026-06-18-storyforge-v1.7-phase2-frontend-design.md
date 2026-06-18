# StoryForge v1.7 Phase 2 — Frontend Design (Creative Canvas + Branch Simulation)

> **Date:** 2026-06-18 | **Status:** Approved | **Based on:** storyForge-design-v1.7-TRD.md §9, Phase 2 Backend Design Spec

## 1. Objective

Implement Phase 2 frontend: Creative Canvas interactive WhatIf tree (React Flow), Branch Simulation two-column page, API client integration, route/navigation updates. All 9 backend endpoints are operational — frontend consumes them.

## 2. Architecture

```
frontend/src/
├── api/
│   └── client.ts                    # +12 TS interfaces, +7 API methods
├── components/
│   ├── creative-canvas/
│   │   ├── WhatIfTree.tsx           # @xyflow/react node tree (core)
│   │   ├── CanvasNode.tsx           # Custom node renderer (color-coded + badges)
│   │   ├── NodeDetailPanel.tsx      # Bottom drawer: details + radar + actions + suggestion
│   │   ├── NoveltyRadar.tsx         # Recharts 4-dim radar chart
│   │   ├── CanvasToolbar.tsx        # Top toolbar: undo/reset/legend/zoom
│   │   └── CanvasEmptyState.tsx     # Empty state guide
│   └── branch-simulation/
│       ├── SimulateForm.tsx         # Left column top: description input + execute button
│       ├── HistoryList.tsx          # Left column bottom: history list
│       ├── ResultViewer.tsx         # Right column: full result display
│       ├── ConfidenceBadge.tsx      # Confidence badge (medium🟡 / low🟠)
│       └── DeterministicTable.tsx   # Deterministic analysis table
├── hooks/
│   ├── useCreativeCanvas.ts         # Canvas state machine
│   └── useBranchSimulation.ts       # Branch simulation state machine
├── pages/
│   ├── CreativeCanvasPage.tsx       # Full-screen canvas + bottom drawer
│   ├── BranchSimulationPage.tsx     # Two-column simulation page
│   └── (modify) Stage1Page.tsx      # Add Quick/Canvas tab toggle
│   └── (modify) Stage3Page.tsx      # Add Outline/Branches tab toggle
```

**Key decisions:**
- WhatIfTree uses `@xyflow/react` (React Flow v12) for node-graph visualization
- NoveltyRadar uses `recharts` `<RadarChart>` for 4-dimension novelty scores
- Bottom drawer panel (h-[42vh], draggable) for node detail — avoids modal fatigue
- Branch simulation uses two-column layout; left narrow (input+history), right wide (results)
- Path selection: click leaf node "select as path endpoint" → auto-traceback along parent_id to root
- Canvas coexists with existing Stage1 quick flow; Stage1 toggle: Quick / Creative Canvas
- Stage3 toggle: Outline / Branch Simulation

## 3. Component Design

### 3.1 WhatIfTree

**Node color coding by dimension:**
| Dimension | Tailwind Color |
|---|---|
| 角色动机 | `#7c3aed` (purple-600) |
| 世界观规则 | `#0891b2` (cyan-600) |
| 情节方向 | `#ea580c` (orange-600) |
| 读者体验 | `#059669` (emerald-600) |

**Node visual states:**
- Root node: double-ring border + `primary-container` background
- Selected node: `ring-2 ring-primary` highlight
- Path nodes: bold edges + checkmark indicator
- Leaf nodes: dashed border
- Node content: dimension badge + content (30-char truncation) + novelty score

**Interactions:**
- Click node → select (bottom drawer slides up)
- Drag to pan, scroll to zoom
- Auto `fitView()` after expand
- Minimap in bottom-right corner

### 3.2 NodeDetailPanel (bottom drawer)

Full-feature panel sliding up from bottom (h-[42vh], draggable resize handle). Contains:
- Left half: node detail info (content, dimension, depth, trope tags, novelty score)
- Right half: NoveltyRadar (Recharts 4-dim polar chart)
- Action bar: [Expand] [Mutate] [Re-evaluate] [Select as Path Endpoint]
- Bottom: Creative Director suggestion text (from `/expand` response)
- `/mutate` button shows "available in Phase 3" tooltip (backend placeholder)

### 3.3 NoveltyRadar

Recharts `<RadarChart>` with 4 axes: market_saturation, trope_similarity, contradiction_depth, discussion_potential. Score range 0-100. Overlays: red ocean warning (< 40) and blue ocean indicator (> 80) as shaded regions.

### 3.4 BranchSimulationPage (two-column)

Left column (w-[380px]):
- Top: textarea + [Execute Simulation] button
- Bottom: HistoryList (clickable items, newest first)

Right column (flex-1):
- DeterministicTable: chapter range, affected characters, foreshadowings, growth shifts, reader metrics
- LLM inference cards (3): each with ConfidenceBadge + content text

### 3.5 ConfidenceBadge

```tsx
interface ConfidenceBadgeProps { confidence: "medium" | "low"; }
// medium → 🟡 中置信度 (bg-amber-100 text-amber-800)
// low    → 🟠 低置信度 (bg-orange-100 text-orange-800)
```

## 4. State Management

### 4.1 useCreativeCanvas Hook

State machine: `empty → initialized → loading → expanded`

```ts
interface CanvasState {
  status: "empty" | "initialized" | "loading";
  nodes: Record<string, WhatIfNode>;
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedPath: string[];
  noveltyScores: Record<string, NoveltyScoreDetail>;
  suggestion: string;
  rootNodeId: string;
}
```

Actions: `initCanvas`, `expandNode`, `selectNode`, `evaluateNode`, `selectPath`, `resetCanvas`

Path selection: clicking "Select as Path Endpoint" on a leaf node triggers `selectPath(leafNodeId)`, which auto-traces parent_id chain to root, calls `POST /select` with the full path array.

### 4.2 useBranchSimulation Hook

```ts
interface SimState {
  status: "idle" | "loading" | "loaded";
  description: string;
  currentReport: BranchSimulationReport | null;
  history: HistoryItem[];
}
```

Actions: `setDescription`, `runSimulation`, `loadHistory`, `selectHistoryItem`

## 5. API Client Additions (client.ts)

### New TypeScript Interfaces

`WhatIfNode`, `CanvasState`, `CanvasEdge`, `NoveltyScoreDetail`, `BranchSimulationReport`, `LLMInference`, `HistoryItem`, `CanvasInitRequest`, `CanvasExpandResponse`, `CanvasSelectResponse`, `SimulationRequest`, `HistoryListResponse`

### New API Methods

```ts
// Creative Canvas
getCanvasState(projectId: string): Promise<CanvasState>
initCanvas(projectId: string, premise: string): Promise<CanvasState>
expandNode(projectId: string, nodeId: string): Promise<CanvasExpandResponse>
evaluateNode(projectId: string, nodeId: string): Promise<NoveltyScoreDetail>
selectPath(projectId: string, pathNodeIds: string[]): Promise<CanvasSelectResponse>

// Branch Simulation
runSimulation(projectId: string, description: string): Promise<BranchSimulationReport>
getSimulationHistory(projectId: string): Promise<HistoryItem[]>
```

Note: `/mutate` and `/merge` endpoints are backend placeholders — not wired in frontend.

## 6. Routes & Navigation

### New Routes

```tsx
/project/:projectId/stage1/canvas   → CreativeCanvasPage
/project/:projectId/stage3/branches → BranchSimulationPage
```

Both inside `<MainLayout>` with `<StageWrapper>` and `<Suspense>`.

### SideNavBar Changes

- Stage 1: expands sub-menu → 快速生成 / 创意画布
- Stage 3: expands sub-menu → 大纲视图 / 分支模拟
- 灵感库 remains disabled (Phase 3)

### Stage1Page Quick/Canvas Toggle

Top tab bar with two pill buttons: `快速生成` (default, existing flow) and `创意画布` (navigates to `/stage1/canvas`). Same tab bar shown at top of CreativeCanvasPage for switching back.

### Stage3Page Outline/Branches Toggle

Top tab bar: `大纲视图` (default, existing flow) / `分支模拟` (navigates to `/stage3/branches`).

## 7. Dependencies

```json
{
  "@xyflow/react": "^12.x",
  "recharts": "^2.x"
}
```

Already in package.json: `react-markdown`, `remark-gfm` (no changes needed).

## 8. Styling Conventions

Follow existing patterns: Tailwind utility classes, CSS variable colors (primary-container, surface-container-low, system-log, etc.), Material Symbols icons, GlassPanel wrapper for card-like sections, `@layer components` for repeated patterns.

## 9. Out of Scope

- `/mutate` and `/merge` backend wiring (endpoints return placeholder)
- 灵感库 workspace integration
- Multi-user collaboration features
- Undo/redo history stack (CanvasToolbar reset only)
- Growth workshop / Style sandbox (Phase 3)
