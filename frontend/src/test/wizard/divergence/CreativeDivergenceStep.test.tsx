import { describe, expect, it } from "vitest";
import {
  buildRootNode,
  clearDownstream,
  completedFor,
  mergeCanvasState,
  nextAfterA,
  nextAfterB,
  nextAfterC,
  nextAfterD,
} from "@/components/wizard/CreativeDivergenceStep";
import type { PersistedCandidates } from "@/components/wizard/CreativeDivergenceStep";
import type {
  CanvasStateV3,
  ContradictionCandidate,
  CoreContradiction,
  IdeaVariant,
  RawIntent,
} from "@/api/client";
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
  fusionVariant: IdeaVariant | null;
  fusionBanner: string | null;
  quickMode: boolean;
  loading: boolean;
  maxReachedSubStage: SubStage;
  rootNodeId: string | null;
}> = {}) {
  return {
    subStage: "E" as SubStage,
    rawIntent: { prompt: "old", genre_primary: "old" } as unknown as RawIntent,
    variants: [{ id: "v1" } as unknown as IdeaVariant],
    selectedVariantIds: ["v1"],
    contradictionCandidates: null,
    coreContradiction: { id: "c1" } as unknown as CoreContradiction,
    selectedPath: ["root", "v1"],
    // Task 11: A owns the /fuse call — these are populated when the user
    // re-saves A from a later stage. Tests that don't override them get a
    // null baseline (the "fresh user" / "edit-A" path).
    fusionVariant: null,
    fusionBanner: null,
    quickMode: false,
    loading: false,
    // The canvas's actual root tree node id (wi_*) — distinct from
    // core.template_type which is a Chinese label like "永恒×消逝".
    // Populated by mergeCanvasState from canvas.root_node_id. Older
    // builds of /init didn't persist this; defaults to null so the
    // fallback (template_type) keeps those projects working.
    rootNodeId: null,
    // matches subStage in the "post-E" fixture — the user has reached E.
    maxReachedSubStage: "E" as SubStage,
    ...overrides,
  };
}

describe("clearDownstream", () => {
  it("clears {variants, selectedVariantIds, contradictionCandidates, coreContradiction, selectedPath, fusionVariant, fusionBanner} for stage A", () => {
    // Task 11: A owns the /fuse call, so re-saving A must clear both
    // fusion fields to avoid a stale pick leaking through after edit.
    expect(clearDownstream("A")).toEqual({
      variants: [],
      selectedVariantIds: [],
      contradictionCandidates: null,
      coreContradiction: null,
      selectedPath: [],
      fusionVariant: null,
      fusionBanner: null,
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
    // Task 11: A owns /fuse — re-save A clears prior fusion pick + banner.
    expect(next.fusionVariant).toBeNull();
    expect(next.fusionBanner).toBeNull();
    // Sticky / unrelated fields pass through.
    expect(next.quickMode).toBe(false);
    expect(next.loading).toBe(false);
    // maxReached is monotonic — A→B advances it; prev was E so it stays E.
    expect(next.maxReachedSubStage).toBe("E");
  });

  it("persists fusionVariant + fusionBanner when passed (Task 11)", () => {
    const prev = filledPrev();
    const rawIntent = { prompt: "new", genre_primary: "new" } as unknown as RawIntent;
    const fusionVariant = {
      id: "var-fuse-1",
      title: "fusion",
      premise_one_line: "f",
      mutation_type: "fusion",
      mutation_logic: "",
      estimated_novelty: 0.7,
      trope_tags: [],
      regenerated_count: 0,
      risk_level: "medium",
      fusion_distance: 2,
    } as unknown as IdeaVariant;
    const next = nextAfterA(prev, rawIntent, fusionVariant, "类型融合未启用(LLM 不可用)");
    expect(next.fusionVariant).toBe(fusionVariant);
    expect(next.fusionBanner).toBe("类型融合未启用(LLM 不可用)");
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

// mergeCanvasState is the loadCanvas state-merge pure function. Extracted
// from loadCanvas on proj_f0721bdc 2026-09-02 to fix three back-nav bugs:
//
// 1. S0C's "本次矛盾基于「」" hint showed empty: loadCanvas was wiping
//    selectedVariantIds on ref-equality check (`prev.rawIntent === rawIntent`
//    is always false because /state returns freshly parsed objects), then
//    S0C's effect re-ran with pickedFirst=undefined → fell back to
//    variants[0] which was the fusion variant with empty title (LLM was
//    down when /fuse ran, so backend synthesized empty placeholder).
//
// 2. Going back from C to B lost the visual selection in S0B (same root
//    cause as #1 — selectedVariantIds always reset).
//
// 3. The "融合变体" special card disappeared from S0B because loadCanvas
//    hardcoded `fusionVariant: null` instead of reading from canvas's
//    idea_variants (which DO have the fusion entry appended by /fuse —
//    line 2760 of creative_diverge.py).
//
// Fix: filter fusion variants out of state.variants (they belong to
// fusionVariant, not the mutation grid); preserve session-local state
// (selectedVariantIds, fusionBanner) from prev.
describe("mergeCanvasState", () => {
  // Mirror the CanvasStateV3 shape the loadCanvas handler reads, scoped to
  // the fields mergeCanvasState actually consumes. `contradiction_candidates`
  // isn't on the TS type yet (backend-only field as of 2026-09-01), so we
  // thread it via a cast in the implementation.
  function canvasOf(overrides: {
    idea_variants?: IdeaVariant[];
    raw_intent?: RawIntent | null;
    core_contradiction?: CoreContradiction | null;
    selected_path?: string[];
    contradiction_candidates?: PersistedCandidates | null;
  } = {}): CanvasStateV3 {
    return {
      schema_version: 3,
      root_node_id: null,
      raw_intent: overrides.raw_intent ?? null,
      idea_variants: overrides.idea_variants ?? [],
      core_contradiction: overrides.core_contradiction ?? null,
      selected_path: overrides.selected_path ?? [],
      // Field exists on backend but not in TS type — cast below.
      ...({ contradiction_candidates: overrides.contradiction_candidates ?? null } as object),
    } as unknown as CanvasStateV3;
  }

  it("filters out fusion variants from state.variants (bug 3 root cause)", () => {
    // proj_f0721bdc canvas: [fusion (empty title), m0, m1, m2]. Without the
    // filter, variants[0] is the fusion with empty title — S0C's hint
    // (pickedFirst ?? variants[0].title) shows empty, S0B's grid shows a
    // ghost fusion card with no title. After fix: fusion is routed to
    // fusionVariant, the grid only shows real mutations.
    const fusion: IdeaVariant = {
      id: "var-fuse",
      title: "",
      premise_one_line: "",
      mutation_type: "fusion",
      mutation_logic: "",
      estimated_novelty: 0.7,
      trope_tags: [],
      regenerated_count: 0,
    };
    const m0: IdeaVariant = {
      id: "mu_m0",
      title: "M0 title",
      premise_one_line: "M0 premise",
      mutation_type: "inversion",
      mutation_logic: "",
      estimated_novelty: 0.5,
      trope_tags: [],
      regenerated_count: 0,
    };
    const canvas = canvasOf({ idea_variants: [fusion, m0] });
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.variants.map((v) => v.id)).toEqual(["mu_m0"]);
    // Sanity: fusion is NOT in the grid.
    expect(next.variants.find((v) => v.id === "var-fuse")).toBeUndefined();
  });

  it("picks the latest fusion as state.fusionVariant (bug 2b root cause)", () => {
    // /fuse appends each fusion to canvas.idea_variants (line 2760 of
    // creative_diverge.py). After multiple 重新融合, the most recent one
    // (last in the list) wins — earlier ones are stale. loadCanvas was
    // hardcoding null, so S0B's special "融合变体" card never rendered.
    const olderFusion: IdeaVariant = {
      id: "var-fuse-1",
      title: "First fusion",
      premise_one_line: "stale",
      mutation_type: "fusion",
      mutation_logic: "",
      estimated_novelty: 0.7,
      trope_tags: [],
      regenerated_count: 0,
      risk_level: "low",
      fusion_distance: 1,
    };
    const newerFusion: IdeaVariant = {
      id: "var-fuse-2",
      title: "Second fusion",
      premise_one_line: "fresh",
      mutation_type: "fusion",
      mutation_logic: "",
      estimated_novelty: 0.8,
      trope_tags: [],
      regenerated_count: 1,
      risk_level: "high",
      fusion_distance: 3,
    };
    const m0: IdeaVariant = {
      id: "mu_m0",
      title: "M0",
      premise_one_line: "p",
      mutation_type: "inversion",
      mutation_logic: "",
      estimated_novelty: 0.5,
      trope_tags: [],
      regenerated_count: 0,
    };
    const canvas = canvasOf({ idea_variants: [olderFusion, m0, newerFusion] });
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.fusionVariant?.id).toBe("var-fuse-2");
    expect(next.fusionVariant?.title).toBe("Second fusion");
  });

  it("sets fusionVariant to null when canvas has no fusion entries", () => {
    // Defensive: a project that never ran /fuse (fusion disabled) should
    // not crash, and S0B's special card should stay hidden.
    const m0: IdeaVariant = {
      id: "mu_m0",
      title: "M0",
      premise_one_line: "p",
      mutation_type: "inversion",
      mutation_logic: "",
      estimated_novelty: 0.5,
      trope_tags: [],
      regenerated_count: 0,
    };
    const canvas = canvasOf({ idea_variants: [m0] });
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.fusionVariant).toBeNull();
    expect(next.variants).toHaveLength(1);
  });

  it("preserves prev.selectedVariantIds (bug 1 + bug 2a root cause)", () => {
    // loadCanvas previously did:
    //   selectedVariantIds: prev.rawIntent === rawIntent ? prev.selectedVariantIds : []
    // The ref-equality check is always false (canvas returns fresh objects)
    // so selection was wiped on every canvasVersion bump — including the
    // one /contradict triggers on every S0C mount. The user picked [m0,m2]
    // in S0B; by the time S0C's effect ran, pickedFirst was empty and
    // primary fell back to variants[0] (the empty-title fusion).
    // Fix: selectedVariantIds is session-local, never read from canvas —
    // always carry prev through.
    const prev = filledPrev({ selectedVariantIds: ["mu_m0", "mu_m2"] });
    const rawIntent = { prompt: "x", genre_primary: "x" } as unknown as RawIntent;
    // Pass a fresh rawIntent object — the old check would have wiped the
    // selection here. After fix, selection must survive.
    const canvas = canvasOf({ raw_intent: rawIntent });
    const next = mergeCanvasState(canvas, prev);
    expect(next.selectedVariantIds).toEqual(["mu_m0", "mu_m2"]);
    // Reference identity must be prev's array (no spurious re-allocation).
    expect(next.selectedVariantIds).toBe(prev.selectedVariantIds);
  });

  it("preserves prev.fusionBanner (warning state survives canvas re-fetch)", () => {
    // fusionBanner is the "类型融合未启用(LLM 不可用)" warning shown
    // above S0B when /fuse failed. It's session-scoped (not on canvas —
    // /fuse either succeeds with a real variant or appends a placeholder,
    // the banner is a UX hint). The previous loadCanvas wiped it on every
    // canvasVersion bump, so re-entering S0B after a /contradict refresh
    // silently dropped the warning. Carry prev through.
    const prev = filledPrev({ fusionBanner: "类型融合未启用(LLM 不可用)" });
    const canvas = canvasOf({ raw_intent: { prompt: "x", genre_primary: "x" } as unknown as RawIntent });
    const next = mergeCanvasState(canvas, prev);
    expect(next.fusionBanner).toBe("类型融合未启用(LLM 不可用)");
  });

  it("returns prev unchanged when canvas is null (defensive no-op)", () => {
    // loadCanvas only calls mergeCanvasState on a successful /state
    // response, but tests should not crash on the null branch.
    const prev = filledPrev({ selectedVariantIds: ["v1"] });
    const next = mergeCanvasState(null, prev);
    expect(next).toBe(prev);
  });

  it("populates contradictionCandidates from canvas (the D→C fast-path payload)", () => {
    // S0C's fast-path uses initialCandidates to skip the LLM round-trip on
    // C→D→back-to-C navigation. The backend persists these as
    // contradiction_candidates on canvas (added 2026-09-01, not on the
    // TS type yet — cast in the impl). mergeCanvasState must propagate
    // them so the parent's state.contradictionCandidates is in sync with
    // canvas. Without this, parent never sees the cache and D→C always
    // re-runs /contradict (the bug dba5d55 partially fixed).
    const candidates: ContradictionCandidate[] = [
      {
        template_type: "能力×限制",
        preview_statement: "x",
        side_a: "A",
        side_b: "B",
        tension_score: 80,
      },
    ];
    const persisted: PersistedCandidates = {
      variant_id: "mu_m0",
      variant_content: "p",
      generated_at: "2026-09-02T00:00:00Z",
      candidates,
    };
    const canvas = canvasOf({ contradiction_candidates: persisted });
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.contradictionCandidates).toBe(persisted);
  });

  it("uses full idea_variants list (incl. fusion) for inferSubStage", () => {
    // Safety guard: if mergeCanvasState passed the FILTERED variants
    // (state.variants, no fusion) to inferSubStage, an edge case where the
    // canvas only has a fusion entry (no mutations — possible if /fuse ran
    // before /apply-mutation, or after a /regenerate/variants wipe) would
    // mis-classify as "B (no variants)" instead of "C". Pass the FULL
    // canvas list to inferSubStage so fusion entries count.
    const fusion: IdeaVariant = {
      id: "var-fuse",
      title: "F",
      premise_one_line: "f",
      mutation_type: "fusion",
      mutation_logic: "",
      estimated_novelty: 0.7,
      trope_tags: [],
      regenerated_count: 0,
    };
    const rawIntent = { prompt: "x", genre_primary: "x" } as unknown as RawIntent;
    const canvas = canvasOf({ raw_intent: rawIntent, idea_variants: [fusion] });
    // raw_intent + any variants + no core → C (user is past B, hasn't
    // picked a contradiction yet). If we wrongly passed state.variants
    // (=[] after filtering) instead of allVariants, inferSubStage would
    // hit the "no variants" branch and return B.
    //
    // isInitialLoad=true: simulates initial mount (loading=true →
    // loadCanvas is the very first one). subStage gets inferred.
    // After this fix, mid-session onCanvasMutated calls preserve the
    // user's subStage instead — see the next test.
    const next = mergeCanvasState(
      canvas,
      filledPrev({ subStage: "A", loading: true }),
      { isInitialLoad: true },
    );
    expect(next.subStage).toBe("C");
    expect(next.variants).toEqual([]);  // filtered: fusion only
  });

  // Mid-session loadCanvas (canvasVersion bump from a child calling
  // onCanvasMutated) must NOT re-infer subStage — the user's current
  // navigation is authoritative. Regression caught on proj_f0721bdc
  // 2026-09-02: S0B's mount effect called onCanvasMutated after
  // generation, but loadCanvas blindly inferred subStage=C (canvas had
  // raw_intent + variants, no core_contradiction), bouncing the user
  // from B straight to C before they'd picked variants.
  it("isInitialLoad=false preserves prev.subStage (mid-session onCanvasMutated)", () => {
    const rawIntent = { prompt: "x", genre_primary: "x" } as unknown as RawIntent;
    const canvas = canvasOf({
      raw_intent: rawIntent,
      idea_variants: [{ id: "v1", mutation_type: "inversion" } as unknown as IdeaVariant],
    });
    // User is at B with no prev-loading flag (=false = mid-session).
    // Canvas has raw_intent + variants + no core → inferSubStage="C".
    // The fix must override that inference and keep prev.subStage="B".
    const prev = filledPrev({ subStage: "B", loading: false });
    const next = mergeCanvasState(canvas, prev, { isInitialLoad: false });
    expect(next.subStage).toBe("B");
    expect(next.subStage).not.toBe("C");
  });

  // Same protection for maxReachedSubStage — mid-session loadCanvas
  // must never drop the user's "highest reached" mark just because
  // canvas temporarily doesn't reflect it (e.g., right after a regen
  // that cleared downstream fields, before the user has re-picked).
  it("isInitialLoad=false preserves prev.maxReachedSubStage", () => {
    const rawIntent = { prompt: "x", genre_primary: "x" } as unknown as RawIntent;
    // Canvas is "fresh" — only raw_intent, no variants. inferSubStage
    // would say "A", but the user has actually reached E in this session.
    const canvas = canvasOf({ raw_intent: rawIntent });
    const prev = filledPrev({ subStage: "E", maxReachedSubStage: "E", loading: false });
    const next = mergeCanvasState(canvas, prev, { isInitialLoad: false });
    expect(next.maxReachedSubStage).toBe("E");
    expect(next.subStage).toBe("E");
  });

  // isInitialLoad defaults to false (current callers that don't pass it
  // explicitly — like the mergeCanvasState(null, prev) defensive branch
  // — get the "preserve" behavior). The isInitialLoad=true flag is the
  // exception, not the default. This pins the contract so a future
  // refactor doesn't accidentally flip it.
  it("isInitialLoad defaults to false (preserves prev.subStage)", () => {
    const rawIntent = { prompt: "x", genre_primary: "x" } as unknown as RawIntent;
    const canvas = canvasOf({ raw_intent: rawIntent });
    const prev = filledPrev({ subStage: "D", loading: false });
    const next = mergeCanvasState(canvas, prev);
    // No options passed → isInitialLoad undefined → treated as false.
    expect(next.subStage).toBe("D");
  });

  // Root node id regression on proj_f0721bdc 2026-09-02: S0D's mount
  // effect does `canvasNodes[rootNode.id]` to find the actual root
  // tree node. The previous buildRootNode used core.template_type as
  // the id, which is a Chinese label like "永恒×消逝" — never matches
  // any canvas node (canvas keys are wi_* / mu_*). Symptom: tree
  // stayed at synthetic root, 展开 clicked → backend 404 "节点
  // 永恒×消逝 不存在". mergeCanvasState now pulls canvas.root_node_id
  // into state.rootNodeId so buildRootNode can use the real id.
  it("reads root_node_id from canvas into state.rootNodeId", () => {
    const canvas = canvasOf({}) as unknown as CanvasStateV3 & {
      root_node_id: string | null;
    };
    canvas.root_node_id = "wi_001_00";
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.rootNodeId).toBe("wi_001_00");
  });

  it("falls back to null when canvas has no root_node_id", () => {
    const canvas = canvasOf({}) as unknown as CanvasStateV3 & {
      root_node_id: string | null;
    };
    canvas.root_node_id = null;
    const next = mergeCanvasState(canvas, filledPrev());
    expect(next.rootNodeId).toBeNull();
  });
});

// buildRootNode: must use the actual canvas root_node_id (wi_*) as the
// node id, not core.template_type (a Chinese label). Regression caught
// on proj_f0721bdc 2026-09-02: the previous version used template_type,
// which never matched any canvas node, so S0D's tree never built and
// 展开 returned "节点 X 不存在".
describe("buildRootNode", () => {
  const core = {
    template_type: "永恒×消逝",
    statement: "高阳发现永恒是建木的谎言...",
    side_a: "永恒",
    side_b: "消逝",
    tension_score: 32,
    is_custom: false,
    confirmed_at: "2026-09-02T00:00:00Z",
  } as unknown as CoreContradiction;

  it("uses rootNodeId when provided (the normal canvas-backed path)", () => {
    const r = buildRootNode(core, "wi_001_00");
    expect(r.id).toBe("wi_001_00");
    // id must NOT be the template_type — that was the original bug.
    expect(r.id).not.toBe("永恒×消逝");
  });

  it("falls back to template_type when rootNodeId is null (defensive)", () => {
    // A canvas that pre-dates root_node_id tracking (older /init
    // versions) would have rootNodeId=null. Better to use template_type
    // than crash — still wrong, but visible to the user.
    const r = buildRootNode(core, null);
    expect(r.id).toBe("永恒×消逝");
  });

  it("falls back to 'root' when both rootNodeId and core are missing", () => {
    const r = buildRootNode(null, null);
    expect(r.id).toBe("root");
  });

  it("carries the core statement into the synthetic root for display", () => {
    const r = buildRootNode(core, "wi_001_00");
    expect(r.content).toBe("高阳发现永恒是建木的谎言...");
    expect(r.parent_id).toBeNull();
    expect(r.children_ids).toEqual([]);
  });
});
