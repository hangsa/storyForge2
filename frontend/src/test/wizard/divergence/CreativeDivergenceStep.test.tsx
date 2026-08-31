import { describe, expect, it } from "vitest";
import { clearedDownstream } from "@/components/wizard/CreativeDivergenceStep";

// Helper takes a DivergenceState-like object + current stage and returns the cleared
// downstream slice. We don't need to construct a full DivergenceState — we only
// check the returned shape.
describe("clearedDownstream", () => {
  it("clears {variants, coreContradiction, selectedPath} for stage A", () => {
    const result = clearedDownstream({} as never, "A");
    expect(result).toEqual({
      variants: [],
      coreContradiction: null,
      selectedPath: [],
    });
  });

  it("clears {coreContradiction, selectedPath} for stage B", () => {
    const result = clearedDownstream({} as never, "B");
    expect(result).toEqual({
      coreContradiction: null,
      selectedPath: [],
    });
  });

  it("clears only {selectedPath} for stage C", () => {
    const result = clearedDownstream({} as never, "C");
    expect(result).toEqual({ selectedPath: [] });
  });

  it("returns {} for stage D (last producing stage)", () => {
    expect(clearedDownstream({} as never, "D")).toEqual({});
  });

  it("returns {} for stage E (terminal)", () => {
    expect(clearedDownstream({} as never, "E")).toEqual({});
  });
});
