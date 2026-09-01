# CreativeDivergenceStep — Track maxReached for Stable Completed Set

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user navigates back from a later sub-stage to an earlier one without clicking 下一步 (i.e., rawIntent/variants/coreContradiction/selectedPath are NOT cleared), keep the later sub-stages reachable in `StepIndicator` so the user can click into them again. Currently D/E go gray the moment subStage drops below them.

**Architecture:** Augment `DivergenceState` with a `maxReachedSubStage: SubStage` invariant. `maxReached` only ever advances (monotonic); it tracks the highest stage the user has finished during this session, independent of where the user is currently. `completedFor` reads `maxReached` instead of `subStage` so the clickable-set is stable across back-navigation. Initial value of `maxReached` is computed via `inferSubStage` at mount (a user who re-enters the step at subStage=E has actually reached E, so all 4 prior stages are reachable).

**Tech Stack:** React 18 + TypeScript frontend · vitest + @testing-library/react

---

## Bug Context

Repro: in `proj_f0721bdc` creative-divergence flow:
1. Complete A → B → C → D → E (after commit, subStage lands on "E", completedFor("E") = ["A","B","C","D"]).
2. Click "3. 矛盾" in StepIndicator — `onJump("C")` fires `setState({subStage: "C"})`. Now `completedFor(state.subStage="C") = ["A","B"]` — D and E drop out of `completed`.
3. StepIndicator disables the D and E chips because `completed.includes("D") === false` and `current !== "D"` (line 23: `isClickable = isCompleted && !isCurrent`).

User can't re-enter D or E without first re-clicking C's 下一步, which clears `selectedPath: []` — defeating the purpose of the "navigate back without saving" affordance.

The `nextAfter{A,B,C,D}` helpers are correct in their spread order — the bug is purely that `completedFor` is called on `subStage` (current position) instead of an "ever reached" history.

---

### Task 1: Add maxReached tracking + update tests

**Files:**
- Modify: `frontend/src/components/wizard/CreativeDivergenceStep.tsx`
- Test: `frontend/src/test/wizard/divergence/CreativeDivergenceStep.test.tsx`

- [ ] **Step 1: Read current state of `CreativeDivergenceStep.tsx`** (already loaded in conversation — proceed to Step 2 directly)

- [ ] **Step 2: Add `maxReachedSubStage` to `DivergenceState`**

In `CreativeDivergenceStep.tsx:21-29`, extend the interface:

```ts
interface DivergenceState {
  subStage: SubStage;
  rawIntent: RawIntent | null;
  variants: IdeaVariant[];
  coreContradiction: CoreContradiction | null;
  selectedPath: string[];
  quickMode: boolean;
  loading: boolean;
  /**
   * Highest sub-stage the user has ever reached during this session.
   * Monotonic — only `nextAfterX` advances it. StepIndicator uses this
   * (not `subStage`) to compute clickable stages so the user can navigate
   * back without losing access to later stages. Initialized in the
   * mount effect from `inferSubStage(backend-state)`.
   */
  maxReachedSubStage: SubStage;
}
```

Update `INITIAL` (line 31-39) to set `maxReachedSubStage: "A"`.

- [ ] **Step 3: Update mount effect to set maxReached**

At line 187-200, the `setState({...})` already initializes `subStage: inferSubStage(...)`. Add `maxReachedSubStage: inferSubStage(...)` (initial value matches the inferred current stage — a user re-entering at subStage=E has actually reached E, so all earlier stages are reachable).

```tsx
setState({
  subStage: inferSubStage({ ... }),
  maxReachedSubStage: inferSubStage({ ... }),  // NEW
  rawIntent,
  variants,
  coreContradiction: core,
  selectedPath: path,
  quickMode: rawIntent?.quick_mode ?? false,
  loading: false,
});
```

- [ ] **Step 4: Update `nextAfter{A,B,C,D}` to advance maxReached**

Each helper should be updated to:
1. Compute `nextMax = max(prev.maxReachedSubStage, newSubStage)` where `newSubStage` is the stage advanced to.
2. Set `maxReachedSubStage: nextMax` in the returned state.
3. NOT change behavior for rawIntent/variants/coreContradiction/selectedPath (existing tests cover this).

Use the existing `SUB_STAGE_ORDER` array for the comparison (index-based). Add a small helper at the bottom (next to the existing helpers):

```ts
function advanceMaxReached(prev: SubStage, next: SubStage): SubStage {
  return SUB_STAGE_ORDER.indexOf(prev) >= SUB_STAGE_ORDER.indexOf(next)
    ? prev
    : next;
}
```

Then in each of `nextAfterA`, `nextAfterB`, `nextAfterC`, `nextAfterD`:

```ts
export function nextAfterA(prev, rawIntent): DivergenceState {
  return {
    ...prev,
    ...clearDownstream("A"),
    rawIntent,
    subStage: "B",
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, "B"),
  };
}
```

For `nextAfterC`, the target depends on `prev.quickMode`:
```ts
export function nextAfterC(prev, coreContradiction): DivergenceState {
  const nextSub = prev.quickMode ? "E" : "D";
  return {
    ...prev,
    ...clearDownstream("C"),
    coreContradiction,
    subStage: nextSub,
    maxReachedSubStage: advanceMaxReached(prev.maxReachedSubStage, nextSub),
  };
}
```

`maxReachedSubStage` MUST be added to ALL FOUR helpers to keep all paths monotonic. Even though `nextAfterC` jumping to E vs D doesn't happen today, the symmetry ensures any future change won't regress.

- [ ] **Step 5: Update `completedFor` to read `maxReachedSubStage`**

At line 153-159:

```ts
// Was: pure function on subStage only. Now: takes the persisted maxReached
// value (independent of current subStage), so navigating back to C
// doesn't drop D and E from the clickable set.
//
// Example: prev maxReached="E", user clicks indicator-3 (C). subStage="C",
// maxReachedSubStage remains "E". completedFor(E) returns ["A","B","C","D"]
// — D and E stay clickable.
function completedFor(maxReached: SubStage): SubStage[] {
  if (maxReached === "A") return [];
  if (maxReached === "B") return ["A"];
  if (maxReached === "C") return ["A", "B"];
  if (maxReached === "D") return ["A", "B", "C"];
  return ["A", "B", "C", "D"]; // E
}
```

And the call site at line 214:
```tsx
const completed = completedFor(state.maxReachedSubStage);
```

- [ ] **Step 6: Update existing tests for the new field**

In `CreativeDivergenceStep.test.tsx`, the `filledPrev` helper (lines 14-33) needs to include `maxReachedSubStage`. The default value depends on what each test is exercising:

```ts
function filledPrev(overrides: Partial<{ ... existing ... }> = {}) {
  return {
    subStage: "E" as SubStage,
    maxReachedSubStage: "E" as SubStage,  // NEW — matches subStage in "post-E" fixture
    rawIntent: ...,
    ...
    ...overrides,
  };
}
```

The existing tests at `nextAfter{A,B,C,D}` will need:
- After calling `nextAfterA(prev, rawIntent)`, assert `next.maxReachedSubStage === "B"` (because A advances to B, and prev.maxReached was "E" in the fixture).
- Similar for B → C → D → E.

- [ ] **Step 7: Add the regression test for this bug**

In `CreativeDivergenceStep.test.tsx`, append a new `describe` block (or extend `nextAfterC` if simpler):

```tsx
describe("maxReachedSubStage stability across back-navigation", () => {
  it("advances monotonically: max(E) stays E after re-saving A (proj_f0721bdc 2026-09-01)", () => {
    // User reached E. maxReachedSubStage="E". Saved everything (selectedPath filled).
    const prev = filledPrev();
    // User clicks indicator-3 (C), no edits, no next click.
    // Simulate this by: jump back via a hypothetical nextAfterX that only
    // changes subStage. There isn't one for "pure jump" — that goes
    // through onJump in the component, not the helpers. Test via
    // nextAfterC with the SAME coreContradiction so nothing clears:
    const coreContradiction = prev.coreContradiction!;
    const next = nextAfterC(prev, coreContradiction);
    // maxReachedSubStage must remain E (advancing max(E, D) = E).
    expect(next.maxReachedSubStage).toBe("E");
    expect(next.subStage).toBe("D"); // quickMode=false default in filledPrev
    // selectedPath must NOT be cleared (the user's path stays valid).
    expect(next.selectedPath).toEqual(prev.selectedPath);
  });

  it("completedFor(E) keeps D and E clickable after navigating back to C", () => {
    // Simulating the user's reported repro: maxReached = E, but subStage = C.
    // We can test this by importing a now-exported completedFor OR by
    // simulating the StepIndicator contract directly.
    //
    // To make this testable without exporting completedFor, do this:
    // 1. Export `completedFor` from CreativeDivergenceStep.tsx.
    // 2. After re-exporting, the test below exercises it.
    expect(completedFor("E")).toEqual(["A", "B", "C", "D"]);
    expect(completedFor("D")).toEqual(["A", "B", "C"]);
    expect(completedFor("C")).toEqual(["A", "B"]);
    expect(completedFor("B")).toEqual(["A"]);
    expect(completedFor("A")).toEqual([]);
  });
});
```

For `Step 7.2` we need to `export function completedFor`. Add `export` at line 153.

- [ ] **Step 8: Run the new test file**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- src/test/wizard/divergence/CreativeDivergenceStep.test.tsx
```

Expected: All tests pass (10 existing + new monotonicity tests).

- [ ] **Step 9: Run full divergence suite to confirm no regression**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- src/test/wizard/divergence/ 2>&1 | tail -10
```

Expected: 38 pass + new monotonicity tests. Pre-existing 4 S0B test failures remain unchanged.

- [ ] **Step 10: Commit**

```bash
cd /Users/longsa/Codes/nebula
git add frontend/src/components/wizard/CreativeDivergenceStep.tsx \
        frontend/src/test/wizard/divergence/CreativeDivergenceStep.test.tsx
git commit -m "fix(divergence): keep later stages clickable after back-nav (proj_f0721bdc)

When the user navigated from sub-stage E back to C via StepIndicator,
without clicking 下一步, D and E went gray because `completedFor` was
computed from the current subStage position. `completedFor(C)=[A,B]`
so D and E (no longer 'current') dropped out of the clickable set.

Fix: track a monotonic `maxReachedSubStage` invariant in DivergenceState.
`nextAfter{A,B,C,D}` advance it on every save; `completedFor` reads it
instead of `subStage`. Going back to C without saving leaves maxReached
at E, so D and E stay clickable. selectedPath stays valid — only an
explicit save with a fresh core contradiction clears the downstream.

This is the converse of the 9da1b89 fix: that one cleared downstream
fields WHEN the user saves an upstream edit; this one preserves them
when the user navigates without saving. Both fixes preserve a single
invariant: 'subStage position alone cannot invalidate prior work.'"
```

---

### Task 2: E2E smoke test on proj_f0721bdc

**Files:** none (verification only)

- [ ] **Step 1: Vite HMR should auto-pick up the change. Hard-reload the browser if needed.**

- [ ] **Step 2: In the browser on proj_f0721bdc:**
1. Open workspace → 项目设定 → 创意发散. The current sub-stage should be E (commit, done). StepIndicator should show A/B/C/D all clickable.
2. **Click "3. 矛盾"** to navigate back to C. The user is now at C but no edit.
3. **Verify**: "5. 提交" and "4. 展开" should still be enabled (not gray). Click them. They should navigate normally.
4. Back-nav should NOT have triggered any reload / re-fetch — selectedPath and coreContradiction should be unchanged (skip the "clear-then-regenerate" path that 9da1b89 introduced).

- [ ] **Step 3: Verify the inverse (still works after fix):** Edit prompt in S0A after back-nav, click 下一步 → S0B shows loading spinner, then new variants populate (this is the existing 9da1b89 path, must still work).

- [ ] **Step 4: No commit needed.**

---

## Self-Review

**Spec coverage:**
- ✅ Later sub-stages stay clickable after navigating back (Task 1).
- ✅ Monotonic invariant: nextAfter{A,B,C,D} all advance maxReached (Step 4).
- ✅ Initial maxReached inferred from backend state (Step 3).
- ✅ Regression test (Step 7).
- ✅ E2E smoke (Task 2).

**Placeholder scan:** zero TBDs.

**Type consistency:** `DivergenceState` extension is additive. `INITIAL.maxReachedSubStage: "A"` is consistent with `INITIAL.subStage: "A"`. Spread helpers preserve `maxReachedSubStage` on `...prev`.

**Edge cases:**
- A fresh user (INITIAL): maxReachedSubStage="A". After clearing on nextAfterA: "B". OK.
- User jumps from C back to A via indicator (no save): no helper runs, so maxReached stays "C" via the initial mount effect, completedFor("C") = ["A","B"]. So **A is no longer clickable** (it's current), but B is clickable. The user can click B to get back. OK.
- Reload after reaching E: maxReached starts at E (inferred from backend state in mount effect). User can click any of A-D. Perfect.
- User starts in quickMode at C → jump to E → jump back to C: maxReached still "E" (advanceMaxReached(E, E)=E). D and E stay clickable. OK.

**Two concerns that might surface in review:**

1. Should completedFor also include the current subStage? No — `isClickable = isCompleted && !isCurrent` already handles "current" via the negative check. Adding current to completed would flip `isClickable` to false on current, hiding the indicator highlight. Keep the current contract.

2. The "fresh user (empty divergence state)" case: maxReachedSubStage="A", completedFor("A")=[]. So no clickable stages. That's the right default.
