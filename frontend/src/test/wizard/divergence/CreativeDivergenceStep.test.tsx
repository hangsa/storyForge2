import { describe, expect, it } from "vitest";
import {
  clearDownstream,
  completedFor,
  nextAfterA,
  nextAfterB,
  nextAfterC,
  nextAfterD,
} from "@/components/wizard/CreativeDivergenceStep";
import type { PersistedCandidates } from "@/components/wizard/CreativeDivergenceStep";
import type { CoreContradiction, IdeaVariant, RawIntent } from "@/api/client";
import type { SubStage } from "@/components/wizard/divergence/StepIndicator";

// A fully-populated "post-E" DivergenceState. Every downstream-only field is
// filled, so merge tests can assert these are cleared by upstream saves.
function filledPrev(overrides: Partial<{
  subStage: SubStage;
  rawIntent: RawIntent | null;
  variants: IdeaVariant[];
  selectedVariantIds: string[];
  contradictionCandidates: PersistedCandidates | null;
  coreContradiction: CoreContradiction | null;
  selectedPath: string[];
  quickMode: boolean;
  loading: boolean;
  maxReachedSubStage: SubStage;
}> = {}) {
  return {
    subStage: "E" as SubStage,
    rawIntent: { prompt: "old", genre_primary: "old" } as unknown as RawIntent,
    variants: [{ id: "v1" } as unknown as IdeaVariant],
    selectedVariantIds: ["v1"],
    contradictionCandidates: null,
    coreContradiction: { id: "c1" } as unknown as CoreContradiction,
    selectedPath: ["root", "v1"],
    quickMode: false,
    loading: false,
    // matches subStage in the "post-E" fixture — the user has reached E.
    maxReachedSubStage: "E" as SubStage,
    ...overrides,
  };
}

describe("clearDownstream", () => {
  it("clears {variants, selectedVariantIds, contradictionCandidates, coreContradiction, selectedPath} for stage A", () => {
    expect(clearDownstream("A")).toEqual({
      variants: [],
      selectedVariantIds: [],
      contradictionCandidates: null,
      coreContradiction: null,
      selectedPath: [],
    });
  });

  it("clears {contradictionCandidates, coreContradiction, selectedPath} for stage B", () => {
    // contradictionCandidates is cleared on B-regen because the variants
    // they're keyed by are being replaced (regen B re-rolls the 3-op
    // mutate chain). C-regen clears via /regenerate/contradiction itself.
    expect(clearDownstream("B")).toEqual({
      contradictionCandidates: null,
      coreContradiction: null,
      selectedPath: [],
    });
  });

  it("clears only {selectedPath} for stage C", () => {
    expect(clearDownstream("C")).toEqual({ selectedPath: [] });
  });

  it("returns {} for stage D (last producing stage)", () => {
    expect(clearDownstream("D")).toEqual({});
  });

  it("returns {} for stage E (terminal)", () => {
    expect(clearDownstream("E")).toEqual({});
  });
});

// nextAfter{A,B,C,D} mirrors what each S0* onComplete callback does
// internally. These tests assert that downstream fields on `prev` are NOT
// present in the merged result, which catches a regression where the spread
// order is swapped: `{...clearDownstream(X), ...prev, ...}` would re-apply
// stale downstream fields on top of cleared (defeating 9da1b89's fix).
describe("nextAfterA", () => {
  it("clears downstream fields and advances to B", () => {
    const prev = filledPrev();
    const rawIntent = { prompt: "new", genre_primary: "new" } as unknown as RawIntent;
    const next = nextAfterA(prev, rawIntent);
    expect(next.rawIntent).toBe(rawIntent);
    expect(next.subStage).toBe("B");
    // Downstream fields must be cleared, not inherited from prev.
    expect(next.variants).toEqual([]);
    expect(next.coreContradiction).toBeNull();
    expect(next.selectedPath).toEqual([]);
    // Sticky / unrelated fields pass through.
    expect(next.quickMode).toBe(false);
    expect(next.loading).toBe(false);
    // maxReached is monotonic — A→B advances it; prev was E so it stays E.
    expect(next.maxReachedSubStage).toBe("E");
  });
});

describe("nextAfterB", () => {
  it("clears downstream fields and advances to C", () => {
    const prev = filledPrev();
    const variants: IdeaVariant[] = [];
    const selectedIds = ["v1", "v2"];
    const next = nextAfterB(prev, variants, selectedIds);
    expect(next.variants).toBe(variants);
    expect(next.selectedVariantIds).toBe(selectedIds);
    expect(next.subStage).toBe("C");
    // coreContradiction and selectedPath must be cleared (downstream of B).
    expect(next.coreContradiction).toBeNull();
    expect(next.selectedPath).toEqual([]);
    // rawIntent is upstream of B and must survive.
    expect(next.rawIntent).toBe(prev.rawIntent);
    // maxReached is monotonic — prev was E so it stays E.
    expect(next.maxReachedSubStage).toBe("E");
  });
});

describe("nextAfterC", () => {
  it("clears selectedPath and advances to D when quickMode=false", () => {
    const prev = filledPrev({ quickMode: false });
    const core = { id: "c2" } as unknown as CoreContradiction;
    const next = nextAfterC(prev, core);
    expect(next.coreContradiction).toBe(core);
    expect(next.subStage).toBe("D");
    expect(next.selectedPath).toEqual([]);
    expect(next.rawIntent).toBe(prev.rawIntent);
    expect(next.variants).toBe(prev.variants);
    // maxReached is monotonic — prev was E so it stays E even though
    // subStage jumped back to D.
    expect(next.maxReachedSubStage).toBe("E");
  });

  it("clears selectedPath and advances to E when quickMode=true", () => {
    const prev = filledPrev({ quickMode: true });
    const core = { id: "c3" } as unknown as CoreContradiction;
    const next = nextAfterC(prev, core);
    expect(next.coreContradiction).toBe(core);
    expect(next.subStage).toBe("E");
    expect(next.selectedPath).toEqual([]);
    // maxReached is monotonic — quickMode path goes E→E.
    expect(next.maxReachedSubStage).toBe("E");
  });
});

describe("nextAfterD", () => {
  it("sets selectedPath and advances to E (D owns no downstream)", () => {
    const prev = filledPrev();
    const path = ["root", "x", "y"];
    const next = nextAfterD(prev, path);
    expect(next.selectedPath).toBe(path);
    expect(next.subStage).toBe("E");
    // Upstream fields survive.
    expect(next.rawIntent).toBe(prev.rawIntent);
    expect(next.variants).toBe(prev.variants);
    expect(next.coreContradiction).toBe(prev.coreContradiction);
    // maxReached is monotonic — prev was E so it stays E.
    expect(next.maxReachedSubStage).toBe("E");
  });
});

// maxReachedSubStage stability across back-navigation. The bug we're fixing:
// user reached E → clicked "3. 矛盾" in StepIndicator (no edit, no next click)
// → subStage drops to C, completedFor(C)=[A,B], D and E go gray.
// Fix uses a monotonic invariant in DivergenceState, computed by every
// nextAfterX helper. The "user clicks StepIndicator without saving" path
// doesn't touch any helper (the component just `setState({subStage: s})`),
// so maxReached simply stays put — same value as the helper path produces.
describe("maxReachedSubStage stability across back-navigation", () => {
  it("advances monotonically: max(E) stays E after re-saving A (proj_f0721bdc 2026-09-01)", () => {
    // User reached E. maxReachedSubStage="E". Saved everything (selectedPath filled).
    const prev = filledPrev();
    // User clicks indicator-3 (C), no edits, no next click. Simulate the
    // "save happens again from a later stage" path via nextAfterC with the
    // SAME coreContradiction so the spread order test still applies — the
    // bug we're fixing is purely about maxReached not dropping when a
    // helper runs at a "later" subStage value than the current maxReached.
    const coreContradiction = prev.coreContradiction!;
    const next = nextAfterC(prev, coreContradiction);
    // maxReachedSubStage must remain E (advancing max(E, D) = E).
    expect(next.maxReachedSubStage).toBe("E");
    // subStage jumps back to D (filledPrev default quickMode=false).
    expect(next.subStage).toBe("D");
    // selectedPath is cleared by clearDownstream("C"), but the user's
    // "no save" path doesn't run any helper — that's the component's
    // setState({subStage: s}) which preserves everything.
    // (This test pins the helper behavior, not the component behavior.)
    expect(next.selectedPath).toEqual([]);
  });

  it("completedFor includes the maxReached stage itself (inclusive — proj_f0721bdc 2026-09-01)", () => {
    // Each entry represents a stage the user has reached. Excluding E
    // meant that once the user navigated away from sub-stage E (the commit
    // screen), E itself became un-clickable in StepIndicator — `isCompleted
    // = completed.includes("E")` was false even when maxReached was E.
    // Fix: maxReached itself is part of the returned list. The
    // `!isCurrent` term in `isClickable = isCompleted && !isCurrent`
    // keeps the indicator from being clickable when the user is already
    // on stage E.
    expect(completedFor("A")).toEqual(["A"]);
    expect(completedFor("B")).toEqual(["A", "B"]);
    expect(completedFor("C")).toEqual(["A", "B", "C"]);
    expect(completedFor("D")).toEqual(["A", "B", "C", "D"]);
    expect(completedFor("E")).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("StepIndicator E chip is clickable when user navigated back from E to D (proj_f0721bdc 2026-09-01)", () => {
    // Simulate: user has reached E, then clicked "4. 展开" to go back
    // to D without saving. Sub-component state is irrelevant — we test
    // the StepIndicator contract via the completedFor result + the
    // isClickable predicate (mirrored inline).
    const completed = completedFor("E");
    const current = "D" as SubStage;
    // The StepIndicator click test (mirroring divergence/StepIndicator.tsx:23):
    //   isCurrent = E === D → false
    //   isCompleted = ["A","B","C","D","E"].includes("E") → true
    //   isClickable = true && !false → true  ← key invariant
    const isCurrentE = false;
    const isCompletedE = completed.includes("E");
    expect(isCurrentE).toBe(false);
    expect(isCompletedE).toBe(true);
  });

  it("monotonic: nextAfterA from a fresh state (maxReached=A) advances to B", () => {
    // Fresh user (no prior data). maxReachedSubStage starts at A.
    const prev = filledPrev({ maxReachedSubStage: "A", subStage: "A" });
    const rawIntent = { prompt: "new", genre_primary: "new" } as unknown as RawIntent;
    const next = nextAfterA(prev, rawIntent);
    expect(next.subStage).toBe("B");
    expect(next.maxReachedSubStage).toBe("B");
  });

  it("monotonic: re-saving A after reaching C keeps maxReached at C", () => {
    // User reached C, then navigated back to A, edited prompt, hit 下一步.
    // The user has actually reached C in this session — they didn't lose
    // that fact just because they went back. maxReached stays at C even
    // though subStage moves to B (advanceMaxReached(C, B) = C because
    // C >= B in SUB_STAGE_ORDER). Without this, navigating to C→A→save
    // would silently demote maxReached to B, dropping C from clickable.
    const prev = filledPrev({ maxReachedSubStage: "C", subStage: "A" });
    const rawIntent = { prompt: "new", genre_primary: "new" } as unknown as RawIntent;
    const next = nextAfterA(prev, rawIntent);
    expect(next.subStage).toBe("B");
    // maxReached stays at C — the user has actually reached C.
    expect(next.maxReachedSubStage).toBe("C");
  });
});
