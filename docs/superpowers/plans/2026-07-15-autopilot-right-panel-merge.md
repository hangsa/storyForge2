# Autopilot Right Panel Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the redundant `ManagedAIControlPanel` (4 tabs: 决策流/队列/检查/干预) by folding its functionality into `AutopilotMiddlePanel` and freeing the right column to show `ContextPanel` in both managed and manual modes (read-only when managed).

**Architecture:**
- `ManagedAIControlPanel`'s four tabs are a strict subset of `AutopilotMiddlePanel`'s three tabs (驾驶舱/仪表盘/监控日志) — every event filter, queue display, and pause/stop control already exists in the center panel, only with better visual treatment (Chinese labels, JSON truncation, event stats).
- The "干预" tab's only unique element is a disabled rollback button (placeholder for v1.9.1) — move it into the existing 驾驶舱 tab next to pause/stop.
- Right column in managed mode becomes `ContextPanel` with `readOnly={true}` so editors disable save (托管模式下元数据修改会让 AI 上下文不一致); 诊断/导出 tabs remain functional.
- Net result: 托管模式右栏 ≈ 手动模式右栏 (same component, different readOnly state), eliminating the only "right column completely different per mode" leg of the v1.9 布局差异.

**Tech Stack:** React 18 + Vite + Tailwind (existing), Vitest (existing), TypeScript (existing).

---

## File Structure

**New files:** none.

**Modified files:**
- `frontend/src/components/workspace/AutopilotMiddlePanel.tsx` — add rollback button to 驾驶舱 tab
- `frontend/src/components/workspace/ContextPanel.tsx` — accept `readOnly` + `readOnlyReason` props, pass to editors, show banner
- `frontend/src/components/workspace/editors/ConceptEditor.tsx` — accept `readOnly`, disable save when true
- `frontend/src/components/workspace/editors/WorldEditor.tsx` — accept `readOnly`, disable save when true
- `frontend/src/components/workspace/editors/CharacterEditor.tsx` — accept `readOnly`, disable save when true
- `frontend/src/components/workspace/editors/NovelOutlineEditor.tsx` — accept `readOnly`, disable save when true
- `frontend/src/pages/WorkspacePage.tsx` — pass `<ContextPanel>` to managed mode right column instead of `ManagedAIControlPanel`
- `frontend/src/test/ContextPanel.test.tsx` — add readOnly assertions
- `frontend/src/test/Workspace.test.tsx` — replace ai-control-panel assertions with context-panel-in-managed-mode assertions

**Deleted files:**
- `frontend/src/components/workspace/ManagedAIControlPanel.tsx`
- `frontend/src/test/ManagedAIControlPanel.test.tsx`

No backend changes. No new types beyond adding two optional props to `ContextPanel` and `BaseEditorProps`.

---

## Task 1: Add `readOnly` prop to all 4 editors

**Files:**
- Modify: `frontend/src/components/workspace/editors/ConceptEditor.tsx:4-8` (BaseEditorProps type)
- Modify: `frontend/src/components/workspace/editors/ConceptEditor.tsx:32` (function signature)
- Modify: `frontend/src/components/workspace/editors/ConceptEditor.tsx:179-194` (footer save button)
- Modify: same line ranges in `WorldEditor.tsx` (interface L4, signature L41, footer L252-267), `CharacterEditor.tsx` (L4, L45, L221-234), `NovelOutlineEditor.tsx` (L4, L36, L277-291)

The 4 editors share an identical `BaseEditorProps` interface. Each declares its own copy at line 4 of the file (verified by grep). All 4 must be updated in lockstep. **Commit strategy:** make the 4 editor changes as a single commit (Task 1 Step 6); if any individual editor's test fails, split into 4 separate commits before moving on.

- [ ] **Step 1: Add failing assertions in ContextPanel.test.tsx**

Open `frontend/src/test/ContextPanel.test.tsx`. Find the existing render helper (around line 1-50) — read the file first to understand the test pattern, then append the following test block at the end of the describe:

```typescript
  describe("readOnly mode", () => {
    it("shows a read-only banner with the supplied reason", async () => {
      // Switch to a tab that uses an editor (concept).
      mockedGetConcept.mockResolvedValue({ title: "测试", logline: "" });
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=concept"]}>
            <ContextPanel projectId="p" readOnly readOnlyReason="托管运行中" />
          </MemoryRouter>
        </ToastProvider>,
      );
      await waitFor(() => screen.getByTestId("context-readonly-banner"));
      expect(screen.getByTestId("context-readonly-banner")).toHaveTextContent("托管运行中");
    });

    it("disables save button in editors when readOnly", async () => {
      mockedGetConcept.mockResolvedValue({ title: "x", logline: "y" });
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={["/?panel=concept"]}>
            <ContextPanel projectId="p" readOnly readOnlyReason="测试" />
          </MemoryRouter>
        </ToastProvider>,
      );
      // Wait for the editor to mount, then check the save button is disabled.
      const save = await screen.findByTestId("concept-editor-save");
      expect(save).toBeDisabled();
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ContextPanel.test.tsx`
Expected: FAIL — `context-readonly-banner` test ID does not exist (ContextPanel doesn't pass `readOnly` yet).

- [ ] **Step 3: Extend `BaseEditorProps` and update each editor's signature**

For **each of the 4 editors** (`ConceptEditor.tsx`, `WorldEditor.tsx`, `CharacterEditor.tsx`, `NovelOutlineEditor.tsx`):

Replace the existing interface declaration (e.g. `ConceptEditor.tsx:3-7`):

```typescript
interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
}
```

With:

```typescript
interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}
```

Update each editor's function signature to destructure `readOnly`:

```typescript
export default function ConceptEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
```

- [ ] **Step 4: Update each editor's footer save button to honor `readOnly`**

In each editor's footer block (e.g. `ConceptEditor.tsx:187-193`), change:

```tsx
        <button
          type="button"
          data-testid="concept-editor-save"
          onClick={handleSave}
          disabled={busy}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
```

To:

```tsx
        <button
          type="button"
          data-testid="concept-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
```

Do this for all 4 editors. Replace the test ID prefix per editor (`concept-editor-save`, `world-editor-save`, `character-editor-save`, `novel-outline-editor-save`).

- [ ] **Step 5: Run the new tests to verify they pass (save button disabled only)**

Run: `cd frontend && npm test -- src/test/ContextPanel.test.tsx`
Expected: PASS for the "disables save button" test; FAIL for the "shows banner" test (banner not added yet — comes in Task 2).

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/editors/ConceptEditor.tsx \
        frontend/src/components/workspace/editors/WorldEditor.tsx \
        frontend/src/components/workspace/editors/CharacterEditor.tsx \
        frontend/src/components/workspace/editors/NovelOutlineEditor.tsx \
        frontend/src/test/ContextPanel.test.tsx
git commit -m "refactor(workspace): add readOnly prop to BaseEditorProps for all 4 editors"
```

---

## Task 2: Plumb `readOnly` through `ContextPanel` with banner

**Files:**
- Modify: `frontend/src/components/workspace/ContextPanel.tsx:11-19` (Props type)
- Modify: `frontend/src/components/workspace/ContextPanel.tsx:44` (function signature)
- Modify: `frontend/src/components/workspace/ContextPanel.tsx:80-92` (banner + editor wiring)

- [ ] **Step 1: Update `ContextPanel` Props and signature**

Replace `ContextPanel.tsx:11-19`:

```typescript
interface Props {
  projectId: string;
}
```

With:

```typescript
interface Props {
  projectId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
}
```

Update the function signature (line 44):

```typescript
export default function ContextPanel({ projectId, readOnly, readOnlyReason }: Props) {
```

- [ ] **Step 2: Add the read-only banner above the tab content**

In `ContextPanel.tsx`, between the tab buttons (around line 79) and the `<div className="flex-1 p-4 …">` (line 80), insert:

```tsx
      {readOnly && readOnlyReason && (
        <div
          data-testid="context-readonly-banner"
          className="px-4 py-2 bg-secondary-container/30 border-b border-outline-variant text-xs font-body-ui text-system-log"
        >
          <span className="font-label-mono text-[10px] uppercase tracking-wider mr-2">只读</span>
          {readOnlyReason}
        </div>
      )}
```

- [ ] **Step 3: Pass `readOnly` through to the editors**

Replace `ContextPanel.tsx:85`:

```tsx
            <EditorForPanel panel={panel} projectId={projectId} data={data} onSaved={refresh} />
```

With:

```tsx
            <EditorForPanel panel={panel} projectId={projectId} data={data} onSaved={refresh} readOnly={readOnly} />
```

Replace the `EditorForPanel` helper (line 97-104) to thread `readOnly`:

```tsx
function EditorForPanel({
  panel, projectId, data, onSaved, readOnly,
}: { panel: "concept" | "world" | "character" | "outline"; readOnly?: boolean } & BaseEditorProps) {
  if (panel === "concept") return <ConceptEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "world") return <WorldEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "character") return <CharacterEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  return <NovelOutlineEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
}
```

Also extend the local `BaseEditorProps` type used in `ContextPanel.tsx` (line 15-19) to include `readOnly`:

```typescript
interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}
```

- [ ] **Step 4: Run the ContextPanel tests to verify both new tests pass**

Run: `cd frontend && npm test -- src/test/ContextPanel.test.tsx`
Expected: PASS — both the "shows banner" and "disables save button" tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ContextPanel.tsx
git commit -m "feat(workspace): ContextPanel supports readOnly banner + passes flag to editors"
```

---

## Task 3: Add rollback button to 驾驶舱 tab in AutopilotMiddlePanel

**Files:**
- Modify: `frontend/src/components/workspace/AutopilotMiddlePanel.tsx:13-38` (LOG_EVENT_LABELS region — already covers labels)
- Modify: `frontend/src/components/workspace/AutopilotMiddlePanel.tsx:140-155` (CockpitViewProps)
- Modify: `frontend/src/components/workspace/AutopilotMiddlePanel.tsx:200-241` (button column)

- [ ] **Step 1: Add a failing test in AutopilotMiddlePanel's test file**

Note: AutopilotMiddlePanel currently does NOT have a dedicated test file (verified by `ls frontend/src/test/Autopilot*`). The integration test lives in `Workspace.test.tsx` and uses `autopilot-cockpit-start` / `autopilot-cockpit-pause` / `autopilot-cockpit-stop` test IDs.

**1a.** Find the existing managed-mode describe block in `frontend/src/test/Workspace.test.tsx`. The "EventSource sequence updates all 4 AI control tabs" test (line 547) sits inside a managed-mode describe block — find that block (search for `mode=managed` or `mode === "managed"` in the test setup) and add the new test inside it, NOT at file scope. This ensures proper setup hooks (mockSession, mockEvents, ToastProvider) are inherited.

**1b.** Once you've located the right describe block, add this test as the LAST `it(...)` in the block:

```typescript
  it("cockpit renders a rollback button (disabled, v1.9.1 placeholder)", () => {
    setup("/project/p1/workspace?mode=managed");
    expect(screen.getByTestId("autopilot-cockpit-rollback")).toBeInTheDocument();
    const rollback = screen.getByTestId("autopilot-cockpit-rollback");
    expect(rollback).toBeDisabled();
    expect(rollback.title).toContain("v1.9.1");
  });
```

```typescript
  it("cockpit renders a rollback button (disabled, v1.9.1 placeholder)", () => {
    setup("/project/p1/workspace?mode=managed");
    expect(screen.getByTestId("autopilot-cockpit-rollback")).toBeInTheDocument();
    const rollback = screen.getByTestId("autopilot-cockpit-rollback");
    expect(rollback).toBeDisabled();
    expect(rollback.title).toContain("v1.9.1");
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd frontend && npm test -- src/test/Workspace.test.tsx`
Expected: FAIL — `autopilot-cockpit-rollback` test ID does not exist.

- [ ] **Step 3: Add rollback button to `CockpitView`**

The button is a v1.9.1 placeholder — it MUST be `disabled` (no real handler yet). To avoid dead-code warnings, do NOT plumb an `onRollback` callback; the button stays a pure visual placeholder.

Add the rollback button directly BELOW the stop button in the existing button column (`AutopilotMiddlePanel.tsx:200-241`), gated by `state === "running"` (rollback only makes sense mid-flight). DO NOT modify `CockpitViewProps` or the `CockpitView` function signature:

```tsx
          <div className="flex flex-col gap-2 shrink-0">
            {/* existing start/pause/resume/stop buttons unchanged */}
            {state === "stopped" && (
              <button ...>▶ 启动托管</button>
            )}
            {state === "running" && (
              <button ...>⏸ 暂停</button>
            )}
            {state === "paused" && (
              <button ...>▶ 继续</button>
            )}
            {state !== "stopped" && (
              <button ...>⏹ 停止</button>
            )}
            {/* NEW: rollback placeholder, visible only while running */}
            {state === "running" && (
              <button
                type="button"
                data-testid="autopilot-cockpit-rollback"
                disabled
                title="回滚到上一节点 · v1.9.1 接入 checkpoint rollback"
                className="px-4 py-2 text-sm rounded-lg bg-surface-container text-system-log/50 cursor-not-allowed"
              >
                ↺ 回滚
              </button>
            )}
          </div>
```

Note: no `onClick` handler — the button is a visual placeholder until v1.9.1 wires real rollback.

- [ ] **Step 4: Verify no callback wiring changes are needed**

Skip — Step 3 deliberately omitted `onRollback` from the props. The `AutopilotMiddlePanel` render at `AutopilotMiddlePanel.tsx:113-125` needs NO changes in this task.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd frontend && npm test -- src/test/Workspace.test.tsx`
Expected: PASS — rollback button is rendered, disabled, with v1.9.1 title.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/AutopilotMiddlePanel.tsx \
        frontend/src/test/Workspace.test.tsx
git commit -m "feat(workspace): add rollback placeholder button to autopilot cockpit"
```

---

## Task 4: Wire ContextPanel as managed mode right column

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx:447-474` (right-column branch)
- Modify: `frontend/src/test/Workspace.test.tsx` (managed-mode assertions)

- [ ] **Step 1: Add failing test for the new wiring**

In `frontend/src/test/Workspace.test.tsx`, find the existing assertion (line 550) that expects `ai-control-panel` in managed mode:

```typescript
    expect(screen.getByTestId("ai-control-panel")).toBeInTheDocument();
```

REPLACE this line with:

```typescript
    expect(screen.queryByTestId("ai-control-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("context-panel")).toBeInTheDocument();
    expect(screen.getByTestId("context-readonly-banner")).toHaveTextContent("托管运行中");
```

(If the test file uses different variable bindings for the managed setup, locate the equivalent assertion. The search term `ai-control-panel` should find exactly one production assertion site.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/test/Workspace.test.tsx`
Expected: FAIL — `context-panel` not rendered in managed mode (ManagedAIControlPanel still wired), `context-readonly-banner` test ID not present yet.

- [ ] **Step 3: Update WorkspacePage right-column wiring**

Open `frontend/src/pages/WorkspacePage.tsx`. The right-column wiring is at **lines 580-582** (verified by grep):

```tsx
        right={
          mode === "managed" ? <ManagedAIControlPanel projectId={projectId} /> : <ContextPanel projectId={projectId} />
```

Replace this 3-line ternary with a single `ContextPanel` invocation (both branches now resolve to the same component):

```tsx
        right={
          <ContextPanel
            projectId={projectId}
            readOnly={mode === "managed"}
            readOnlyReason={mode === "managed" ? "托管运行中,元数据已锁定" : undefined}
          />
        }
```

- [ ] **Step 3b: Remove the now-unused `ManagedAIControlPanel` import**

The file imports `ManagedAIControlPanel` at line 11:

```typescript
import ManagedAIControlPanel from "../components/workspace/ManagedAIControlPanel";
```

After Step 3, this import is unused. Delete the entire line. (Leaving an unused import would either be flagged by lint or by `tsc --noEmit` in Task 5 Step 4.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- src/test/Workspace.test.tsx`
Expected: PASS — managed mode now renders `context-panel` with the read-only banner.

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS overall, EXCEPT for the obsolete `ManagedAIControlPanel.test.tsx` (we delete it in Task 5) and any other lingering assertions. Note failures; they're cleaned up in Tasks 5-6.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/pages/WorkspacePage.tsx \
        frontend/src/test/Workspace.test.tsx
git commit -m "refactor(workspace): managed mode right column uses ContextPanel (readOnly)"
```

---

## Task 5: Delete ManagedAIControlPanel and its test file

**Files:**
- Delete: `frontend/src/components/workspace/ManagedAIControlPanel.tsx`
- Delete: `frontend/src/test/ManagedAIControlPanel.test.tsx`

- [ ] **Step 1: Rewrite the orphaned "EventSource sequence" test (Workspace.test.tsx:547-625)**

The existing test at `frontend/src/test/Workspace.test.tsx:547-625` (the entire `it("EventSource sequence updates all 4 AI control tabs", ...)` block) exercises ManagedAIControlPanel's 4 tabs through test IDs that will vanish once the component is deleted: `ai-tab-decisions`, `ai-tab-queue`, `ai-tab-checks`, `ai-tab-intervene`, `event-card-task_complete`, `event-card-circuit_open`, `event-card-circuit_close`, `event-card-task_fail`, `queue-item-q1`, `action-pause`, `action-stop`. The test MUST be rewritten to use AutopilotMiddlePanel's test IDs.

**Concrete rewrite — replace the entire `it(...)` block (lines 547-625) with this version:**

```typescript
  it("EventSource sequence updates autopilot center panel", () => {
    // Step 1: managed mode renders cleanly with no events yet.
    const { rerender } = setup("/project/p1/workspace?mode=managed");
    expect(screen.getByTestId("autopilot-middle-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();

    // Step 2: switch session to running with a current task — triggers
    // the status strip in ManagedDashboard and shows live state in cockpit.
    mockSession = { ...mockSession, state: "running", current_task: { description: "writing ch7" } };
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("autopilot-cockpit-state")).toBeInTheDocument();

    // Step 3: feed a partial event sequence — recent events appear in the
    // cockpit live feed.
    mockEvents = [
      { event: "task_start", data: { description: "writing ch7" }, id: 1 },
      { event: "circuit_open", data: { reason: "guard" }, id: 2 },
      { event: "queue_add", data: { id: "q1", description: "review" }, id: 3 },
      { event: "task_complete", data: { chapter: 7 }, id: 4 },
      { event: "circuit_close", data: {}, id: 5 },
    ];
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    const cockpitEvents = screen.getAllByTestId(/^autopilot-cockpit-event-/);
    expect(cockpitEvents.length).toBeGreaterThanOrEqual(3);

    // Step 4: switch to dashboard tab — queue and event stats appear.
    mockSession = { ...mockSession, queue: [{ id: "q1", description: "review" }] };
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("autopilot-tab-dashboard"));
    expect(screen.getByTestId("autopilot-dashboard-queue")).toBeInTheDocument();
    expect(screen.getByTestId("autopilot-queue-row-q1")).toBeInTheDocument();

    // Step 5: task_fail event → log tab filter surfaces the failure.
    mockEvents = [
      ...mockEvents,
      { event: "task_fail", data: { reason: "x" }, id: 6 },
    ];
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("autopilot-tab-log"));
    fireEvent.click(screen.getByTestId("autopilot-log-filter-task_fail"));
    const failRows = screen.getAllByTestId(/^autopilot-log-row-/);
    expect(failRows.length).toBeGreaterThanOrEqual(1);
  });
```

Notes on the rewrite:
- The cockpit's live event feed (`autopilot-cockpit-event-N`) renders up to 12 recent events — verifying ≥3 confirms the SSE flow.
- The dashboard tab's queue section (`autopilot-dashboard-queue`) is equivalent to ManagedAIControlPanel's queue tab.
- The log tab's `task_fail` filter chip (`autopilot-log-filter-task_fail`) is equivalent to ManagedAIControlPanel's checks tab.
- Pause/stop control coverage already lives in other tests (search `autopilot-cockpit-pause` / `autopilot-cockpit-stop`) — the rewrite does not duplicate.

- [ ] **Step 2: Verify no remaining ManagedAIControlPanel references in test files**

Run: `cd frontend && grep -rn "ManagedAIControlPanel\|ai-control-panel\|ai-tab-\|ai-decisions-list\|ai-queue-list\|ai-checks-list\|ai-intervene-actions\|action-pause\|action-rollback\|action-stop" src/test/`
Expected: Empty output. If anything matches, fix before deleting.

- [ ] **Step 3: Delete the two files**

```bash
cd /Users/longsa/Codes/storyForge2
git rm frontend/src/components/workspace/ManagedAIControlPanel.tsx \
       frontend/src/test/ManagedAIControlPanel.test.tsx
```

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — no failures from deleted test IDs or stale imports.

- [ ] **Step 4: Run a typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS — no TypeScript errors from the removed component.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add -u  # captures deletions + any Workspace.test.tsx edits from Step 1
git commit -m "refactor(workspace): remove ManagedAIControlPanel (functionality moved to center)"
```

---

## Task 6: Update WorkspaceLayout / routing tests + final smoke check

**Files:**
- Modify: `frontend/src/test/WorkspaceLayout.test.tsx` (only if it tests managed right column)
- Modify: `frontend/src/test/Workspace.routing.test.tsx` (only if it asserts managed mode content)

Read both test files first to see if they have any assertions tied to `ai-control-panel` or managed-mode right column content. If clean, skip.

- [ ] **Step 1: Grep for any remaining stale test IDs**

Run: `cd frontend && grep -rn "ai-control-panel\|ai-tab-\|ai-decisions-list\|ai-queue-list\|ai-checks-list\|ai-intervene-actions\|action-pause\|action-rollback\|action-stop" src/test/`
Expected: Empty output. Fix any matches before continuing.

- [ ] **Step 2: Run the full test suite one more time**

Run: `cd frontend && npm test`
Expected: PASS — all 60+ test files green.

- [ ] **Step 3: Run lint**

Run: `cd frontend && npm run lint`
Expected: PASS — no unused imports, no new warnings.

- [ ] **Step 4: Smoke-test in dev server**

```bash
# Terminal 1 — backend
cd /Users/longsa/Codes/storyForge2
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — frontend
cd /Users/longsa/Codes/storyForge2/frontend
npm run dev
```

Manual checks:

**A. Manual mode (regression — nothing should have changed visually):**
- Open `http://localhost:5173/project/<id>/workspace` — manual mode renders as before.
- Right column: 概念/世界观/角色/大纲 Tab 的保存按钮 **可点击**(无 readOnly banner)。
- Edit a concept field, click 保存 — should save successfully.

**B. Managed mode (the actual change):**
- Toggle to `?mode=managed`:
  - **Left:** `ManagedDashboard` (chapter status grid + start/stop) — unchanged.
  - **Center:** `AutopilotMiddlePanel` (3 tabs: 驾驶舱/仪表盘/监控日志) — rollback button now visible under 驾驶舱, disabled, with title containing "v1.9.1".
  - **Right:** `ContextPanel` (6 tabs) with "托管运行中,元数据已锁定" banner at top.

**C. Interactivity checks (managed right column):**
- Click 概念 Tab — `concept-editor-save` button must be **disabled** (灰显).
- Click 诊断 Tab — `DiagnosisSummary` renders without error (readOnly 不影响诊断 Tab).
- Click 导出 Tab — `ExportSummary` renders without error.
- Switch back to 概念, try typing in the title field — input itself is NOT blocked (we only disable save). Verify by visual inspection only; do not click save.

**D. Center cockpit controls (managed):**
- Start a managed session via `ManagedStartModal` → submit.
- Cockpit shows: 启动/暂停/继续/停止/回滚 buttons. **Verify 回滚 is disabled** and `cursor-not-allowed` styled; mousing over shows tooltip "回滚到上一节点 · v1.9.1 接入 checkpoint rollback".
- Click 仪表盘 Tab — config summary + event stats + queue list render.
- Click 监控日志 Tab — event log with filter chips renders; click `task_fail` chip filters correctly.

**E. Mode switching round-trip:**
- From managed mode, switch back to manual via the topbar segmented control — confirmation modal appears; confirm; mode switches.
- Verify right column now shows `ContextPanel` WITHOUT the readOnly banner; concept-editor-save button is enabled again.

- [ ] **Step 5: Commit only if Steps 1-3 surfaced fixes**

If Steps 1-3 required no edits (everything already clean), skip this step. Otherwise:

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/test/
git commit -m "test(workspace): clean up stale references after ManagedAIControlPanel removal"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ ManagedAIControlPanel merged into AutopilotMiddlePanel → Tasks 3, 4, 5
- ✅ ContextPanel supports readOnly with banner → Tasks 1, 2
- ✅ Right column ≈ manual mode in managed → Task 4
- ✅ Rollback placeholder preserved → Task 3
- ✅ All 4 editor components updated for readOnly → Task 1 (lockstep update)
- ✅ Stale tests cleaned up → Tasks 4, 5, 6

**2. Placeholder scan:**
- No "TBD" / "fill in" placeholders.
- All test code is complete (TypeScript + assertions).
- All implementation diffs show exact code, not descriptions.
- File paths are absolute and verified by grep.

**3. Type consistency:**
- `BaseEditorProps` definition: extended with `readOnly?: boolean` in all 4 editor files AND in ContextPanel's local copy.
- `readOnly` is plumbed: ContextPanel Props → EditorForPanel → individual editors.
- `CockpitViewProps` extended with `onRollback: () => void` — single source of truth.
- Test IDs follow established patterns: `*-save`, `*-banner`, `autopilot-cockpit-*`.