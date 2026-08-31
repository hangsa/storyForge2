import { describe, expect, it } from "vitest";
import {
  clearDownstream,
  nextAfterA,
  nextAfterB,
  nextAfterC,
  nextAfterD,
} from "@/components/wizard/CreativeDivergenceStep";
import type { CoreContradiction, IdeaVariant, RawIntent } from "@/api/client";
import type { SubStage } from "@/components/wizard/divergence/StepIndicator";

// A fully-populated "post-E" DivergenceState. Every downstream-only field is
// filled, so merge tests can assert these are cleared by upstream saves.
function filledPrev(overrides: Partial<{
  subStage: SubStage;
  rawIntent: RawIntent | null;
  variants: IdeaVariant[];
  coreContradiction: CoreContradiction | null;
  selectedPath: string[];
  quickMode: boolean;
  loading: boolean;
}> = {}) {
  return {
    subStage: "E" as SubStage,
    rawIntent: { prompt: "old", genre_primary: "old" } as unknown as RawIntent,
    variants: [{ id: "v1" } as unknown as IdeaVariant],
    coreContradiction: { id: "c1" } as unknown as CoreContradiction,
    selectedPath: ["root", "v1"],
    quickMode: false,
    loading: false,
    ...overrides,
  };
}

describe("clearDownstream", () => {
  it("clears {variants, coreContradiction, selectedPath} for stage A", () => {
    expect(clearDownstream("A")).toEqual({
      variants: [],
      coreContradiction: null,
      selectedPath: [],
    });
  });

  it("clears {coreContradiction, selectedPath} for stage B", () => {
    expect(clearDownstream("B")).toEqual({
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
  });
});

describe("nextAfterB", () => {
  it("clears downstream fields and advances to C", () => {
    const prev = filledPrev();
    const variants: IdeaVariant[] = [];
    const next = nextAfterB(prev, variants);
    expect(next.variants).toBe(variants);
    expect(next.subStage).toBe("C");
    // coreContradiction and selectedPath must be cleared (downstream of B).
    expect(next.coreContradiction).toBeNull();
    expect(next.selectedPath).toEqual([]);
    // rawIntent is upstream of B and must survive.
    expect(next.rawIntent).toBe(prev.rawIntent);
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
  });

  it("clears selectedPath and advances to E when quickMode=true", () => {
    const prev = filledPrev({ quickMode: true });
    const core = { id: "c3" } as unknown as CoreContradiction;
    const next = nextAfterC(prev, core);
    expect(next.coreContradiction).toBe(core);
    expect(next.subStage).toBe("E");
    expect(next.selectedPath).toEqual([]);
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
  });
});
