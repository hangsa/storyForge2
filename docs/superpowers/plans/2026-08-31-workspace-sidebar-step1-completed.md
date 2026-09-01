# Workspace Sidebar — Step 1 Completion Detection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 7-stage workspace wizard sidebar treat step 1 (创意发散 / Creative Divergence) as completed when `creative_divergence.json` exists on disk, so users can re-enter step 1 by clicking the sidebar instead of having to use "上一步".

**Architecture:** Extend the existing prefill pass in `WorkspaceWizardPanel.tsx` to also read `creative_divergence.json` via a new lightweight backend GET endpoint. The frontend's `WizardSidebar.reachable` logic is already correct (`completed || current`); the bug is purely that `completedSteps` is missing `1` because prefill never looked at the divergence file.

**Tech Stack:** Python (FastAPI) backend · React 18 + TypeScript frontend · vitest + @testing-library/react · pytest

---

## Bug Context

- Project `proj_f0721bdc` has `creative_divergence.json` on disk with `selected_at` populated (the user reached S0E Commit). `project.json.current_stage="INIT"`, `concept_and_dna.json` also populated.
- `WorkspaceWizardPanel.tsx:46-67` prefill reads `concept/world/character/novel_outline/outline`, marks steps `[2, 3, 4, 6, 7]` as completed, but **never reads `creative_divergence.json`**.
- After this prefill runs, `completedSteps=[2, 3]`, so step 1 (`completedSteps.includes(1)===false && currentStep===1===false`) is unreachable in `WizardSidebar.tsx:25`.
- "上一步" works because `wizard-prev` uses `jumpToStep` which is unconditional on the reducer side (`WizardContext.tsx:269-275`). That unconditional jump is fine for the reducer — the bug is that step 1 is missing from `completedSteps`, which is what the sidebar gates on.

## Decision: Why Not Hydrate `data.creative_divergence`?

The `creative_divergence` field is in `WizardData` type and participates in STEP_COMPLETED's `STEP_DATA_KEY_TO_STEP` mapping for the resave-flow clearing logic. **However, `CreativeDivergenceStep.tsx:84-89` does NOT read `wizard.data.creative_divergence`** — it loads its state directly from `api.getDivergeState(projectId)` (Path A canvas state API). The wizard.data field is referenced nowhere in the step component (confirmed by grep: zero hits outside WizardContext.tsx).

Therefore we do not need to populate `wizard.data.creative_divergence` to fix the sidebar — pushing `1` into `completedSteps` is sufficient. The empty `data.creative_divergence={...}` patch we pass into `hydrateFromFiles` will be safely ignored.

---

### Task 1: Add `GET /creative-divergence/prefill-check` already exists — no new endpoint needed

**Files:** none (the existing endpoint at `backend/api/creative_divergence.py:154-160` returns `exists` and `has_selection` exactly as we need for prefill detection, but it returns just booleans, not the data shape. We need a richer payload that includes `selected_at` and `variants` — see Task 1b.)

Actually, **re-scope**: skip this task. We will extend the existing `/creative-divergence` GET endpoint at line 107 to include `has_selection` and `selected_at`, since that's used both for the step 1 UI and prefill.

---

### Task 1 (revised): Extend existing `GET /creative-divergence` endpoint payload

**Files:**
- Modify: `backend/api/creative_divergence.py:107-110` (extend `list_variants`)
- Test: `tests/test_creative_divergence.py` (or wherever the existing API tests live — see below)

- [ ] **Step 1: Locate existing tests for `GET /creative-divergence`**

Run: `grep -rn "creative-divergence/prefill-check\|list_variants\|test.*list_variants" /Users/longsa/Codes/nebula/tests/`

If no targeted unit test exists for the `list_variants` endpoint shape, skip writing a new test and rely on the integration test in Task 2.

- [ ] **Step 2: Extend `list_variants` response**

In `backend/api/creative_divergence.py:107-110`, replace:

```python
@router.get("/creative-divergence")
def list_variants(project_id: str):
    data = _read_cd(project_id)
    return {"variants": data["variants"], "selected_id": data.get("selected_id")}
```

with:

```python
@router.get("/creative-divergence")
def list_variants(project_id: str):
    """List creative-divergence variants + selection marker.

    The additional `has_selection` + `selected_at` fields let the workspace
    wizard prefill pass detect "creative divergence completed" without
    needing a second round-trip to a preflight-check endpoint. The
    sidebar's `completed || current` reachability test in WizardSidebar.tsx
    depends on completedSteps including 1 when creative_divergence.json
    has selected_at populated — which the prefill pass now reads from this
    payload (proj_f0721bdc 2026-08-31 regression where step 1 sidebar item
    stayed grayed out after a complete divergence run).
    """
    data = _read_cd(project_id)
    selected_at = data.get("selected_at")
    return {
        "variants": data["variants"],
        "selected_id": data.get("selected_id"),
        "has_selection": data.get("selected_id") is not None,
        "selected_at": selected_at,
    }
```

- [ ] **Step 3: Verify the existing tests still pass**

Run: `cd /Users/longsa/Codes/nebula && pytest tests/ -k "creative_diverge" -v 2>&1 | tail -20`

Expected: All existing creative_diverge tests still pass; no test currently asserts on the exact response shape so the field additions are backward-compatible.

- [ ] **Step 4: Commit**

```bash
cd /Users/longsa/Codes/nebula
git add backend/api/creative_divergence.py
git commit -m "feat(backend): expose has_selection + selected_at on GET /creative-divergence

Workspace wizard prefill needs to detect 'step 1 (creative divergence)
completed' from the divergence file on disk so the sidebar item is
clickable for re-entry. The existing prefill-check endpoint returned
just booleans — folding has_selection + selected_at into the main list
endpoint lets the prefill pass make a single round-trip and avoids a
second preflight call.

Backward compatible: only adds fields, doesn't rename or remove any.
proj_f0721bdc 2026-08-31 — sidebar step 1 stayed grayed out after
the divergence run completed because completedSteps was missing 1."
```

---

### Task 2: Extend WorkspaceWizardPanel prefill to read creative_divergence.json

**Files:**
- Modify: `frontend/src/components/wizard/WorkspaceWizardPanel.tsx:46-67` (the prefill useEffect)
- Test: `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx` (extend existing prefill tests — see Step 1)

- [ ] **Step 1: Locate existing prefill tests**

Run: `grep -n "prefill\|hydrat\|concept.*world\|completedSteps" /Users/longsa/Codes/nebula/frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx | head -20`

Confirm at least one test exercises the prefill useEffect that we are about to modify. (The test file at `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx` is verified-present by grep; the test "renders WizardSidebar + step 1 canvas" at line 26 covers basic mount but may not cover prefill specifically.)

- [ ] **Step 2: Add `getCreativeDivergence` to API client**

Look at `frontend/src/api/client.ts:1472-1476` — `getDivergeState` exists for Path A. For Path B we need a sibling. Find or add:

```ts
getCreativeDivergence: (projectId: string) =>
  request<{
    variants: Array<{ id: string; label: string; title: string; description: string; tags: string[]; created_at: string }>;
    selected_id: string | null;
    has_selection: boolean;
    selected_at: string | null;
  }>(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/creative-divergence`,
  ),
```

Note: The `request` helper likely prefixes with a base URL — confirm by reading the helper, and adjust the path so it hits `backend/api/creative_divergence.py:107` correctly.

- [ ] **Step 3: Extend the prefill Promise.allSettled to include the creative-divergence call**

In `frontend/src/components/wizard/WorkspaceWizardPanel.tsx:46-67`, modify the prefill block. Replace lines 46-67 with:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const [cd, concept, world, chars, novel, outline] = await Promise.allSettled([
        api.getCreativeDivergence(projectId),
        api.getConcept(projectId),
        api.getWorld(projectId),
        api.getCharacter(projectId),
        api.getNovelOutline(projectId),
        api.getOutline(projectId),
      ]);
      if (cancelled) return;
      const completed: number[] = [];
      const data: Partial<WizardData> = {};
      // Step 1 (creative divergence) is "completed" once the user has
      // committed a selection. Without this, the sidebar's `reachable =
      // completed || current` test (WizardSidebar.tsx:25) keeps step 1
      // grayed out even after a divergence run finishes — proj_f0721bdc
      // 2026-08-31 regression. CreativeDivergenceStep re-fetches its own
      // state via getDivergeState on mount, so we don't need to populate
      // `data.creative_divergence`; we only need the completion marker.
      const cdPayload = cd.status === "fulfilled" ? cd.value : null;
      if (cdPayload && cdPayload.has_selection && cdPayload.selected_at) {
        completed.push(1);
      }
      const conceptPayload = concept.status === "fulfilled" ? concept.value : null;
      if (conceptPayload && hasContent(conceptPayload)) {
        completed.push(2);
        const c = (conceptPayload as { concept?: Concept }).concept;
        const dna = (conceptPayload as { story_dna?: StoryDNA }).story_dna;
        if (c) data.concept = c;
        if (dna) data.story_dna = dna;
      }
      if (world.status === "fulfilled" && hasContent(world.value)) { completed.push(3); data.world = world.value as World; }
      if (chars.status === "fulfilled" && hasContent(chars.value)) { completed.push(4); data.characters = chars.value as CharacterSet; }
      if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(6); data.novel_outline = novel.value as NovelOutline; }
      if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(7); data.chapter1_outline = outline.value as Outline; }
      if (completed.length > 0) wizard.hydrateFromFiles(completed, data);
      else wizard.markPrefillComplete();
    } catch {
      if (!cancelled) wizard.markPrefillComplete();
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [projectId]);
```

The change is purely additive: one more entry in `Promise.allSettled`, one more `cdPayload` check, one `completed.push(1)`. The `hydrateFromFiles` is called as before.

- [ ] **Step 4: Mock the new API method in existing WorkspaceWizardPanel tests**

In `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx`, the existing `vi.mock("@/api/client", ...)` block at the top must grow. Add `getCreativeDivergence: vi.fn()` to the mock default. Existing tests pass `mockResolvedValue` defaults — add a default that returns `{ variants: [], selected_id: null, has_selection: false, selected_at: null }` so existing tests that don't care about step 1 don't regress.

- [ ] **Step 5: Add a regression test for proj_f0721bdc**

In `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx`, add a new test inside the existing `describe`:

```tsx
it("prefills completedSteps=[1] when creative_divergence.json has a selection (proj_f0721bdc 2026-08-31)", async () => {
  (api.getCreativeDivergence as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    variants: [{ id: "v1", label: "ALPHA", title: "T", description: "D", tags: [], created_at: "2026-08-31T14:00:00Z" }],
    selected_id: "v1",
    has_selection: true,
    selected_at: "2026-08-31T14:00:05.164787",
  });
  (api.getConcept as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    concept: { title: "建木之囚", genre: "爽文", premise: "P", tone: "T", theme: "T", target_audience: "A", style_template: "" },
    story_dna: { core_contradiction: { statement: "S", side_a: "A", side_b: "B" }, value_stack: [] },
  });
  render(<WorkspaceWizardPanel projectId="proj_f0721bdc" />);
  await waitFor(() => {
    // Sidebar item 1 should NOT be disabled once prefill completes.
    expect(screen.getByTestId("wizard-sidebar-item-1")).not.toHaveAttribute("disabled");
    // Sidebar item 3 (世界 outline step), 4 (character), etc., are still
    // disabled because we didn't mock a world.json here.
    expect(screen.getByTestId("wizard-sidebar-item-3")).toHaveAttribute("disabled");
  });
});
```

- [ ] **Step 6: Run vitest, confirm new test passes and existing tests do not regress**

Run: `cd /Users/longsa/Codes/nebula/frontend && npm test -- src/components/wizard/WorkspaceWizardPanel.test.tsx`

Expected: All tests pass, including the new regression test.

- [ ] **Step 7: Run full frontend test suite to catch any lateral breakage**

Run: `cd /Users/longsa/Codes/nebula/frontend && npm test 2>&1 | tail -30`

Expected: All previously-passing tests still pass. The prefill test in `WorkspacePage.test.tsx` and any other prefill-dependent test should be unaffected because the new API call only adds to `completedSteps`, never removes.

- [ ] **Step 8: Commit**

```bash
cd /Users/longsa/Codes/nebula
git add frontend/src/api/client.ts \
        frontend/src/components/wizard/WorkspaceWizardPanel.tsx \
        frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx
git commit -m "feat(frontend): include step 1 (creative divergence) in workspace wizard prefill

Workspace wizard prefill read concept/world/character/novel/outline
files to populate completedSteps but never read creative_divergence.json.
Result: the sidebar's step-1 item stayed grayed out even after a full
divergence run completed and committed (proj_f0721bdc 2026-08-31).
'上一步' worked because jumpToStep bypasses the sidebar enabled test.

Fix: extend the prefill Promise.allSettled to also fetch
getCreativeDivergence and push 1 to completedSteps when
has_selection && selected_at. CreativeDivergenceStep reads its own
canvas state via getDivergeState on mount, so we don't need to
populate data.creative_divergence — only the completion marker.

Tasks: backend Task 1 added has_selection + selected_at to the
GET /creative-divergence payload."
```

---

### Task 3: End-to-end verification on proj_f0721bdc

**Files:** none (smoke test only)

- [ ] **Step 1: Restart backend to pick up Task 1's endpoint change**

```bash
# Per memory project_uvicorn_reload_hangs_on_sse, hard-kill is safer than --reload
# for backend .py edits while a cockpit SSE stream may be open.
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
cd /Users/longsa/Codes/nebula
unset MINIMAX_API_KEY   # per project_minimax_api_key_env_overrides_dotenv memory
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 > /tmp/backend.log 2>&1 &
```

- [ ] **Step 2: Verify endpoint shape manually**

```bash
curl -s http://localhost:8000/api/projects/proj_f0721bdc/creative-divergence | python3 -m json.tool
```

Expected: JSON containing `variants`, `selected_id`, `has_selection=true`, `selected_at="2026-08-31T14:00:05.164787"`.

- [ ] **Step 3: Restart frontend (not strictly needed since we changed only frontend code; vite HMR will handle it, but do a hard reload if HMR misses the change to imports)**

If the import-resolution change in client.ts doesn't propagate via HMR, in browser: hard reload (Cmd+Shift+R) on http://localhost:5174. Then navigate to workspace tab → 项目设定.

- [ ] **Step 4: Verify in browser that step 1 sidebar item is now clickable**

- Step 1 should show a check icon (not the gray dot).
- Clicking it should mount CreativeDivergenceStep (which then proceeds normally to S0E re-confirm flow).
- Other completed steps should still be clickable; pending steps still grayed out.

- [ ] **Step 5: No commit needed** (this is verification)

---

## Self-Review

**Spec coverage:**
- ✅ Sidebar reachability for step 1 when divergence is committed (Task 1 + Task 2).
- ✅ Backend returns the data the frontend needs (Task 1).
- ✅ Frontend prefill uses it (Task 2).
- ✅ End-to-end smoke test (Task 3).

**Placeholder scan:** Zero. All code blocks are exact.

**Type consistency:** Uses existing `wizard.completedSteps`, existing `hydrateFromFiles` action, existing `hasContent` helper. No new types introduced beyond the API method's inline request/response typing — matches the pattern of `getConcept`, `getWorld`, etc.

**Why this is small enough for one plan:** Two source files (~30 lines total), one test file extension, no architectural decisions.
