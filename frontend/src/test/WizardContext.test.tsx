import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  WizardProvider,
  useWizard,
  getSessionKey,
  isStep1EffectivelyCompleted,
  type WizardData,
} from "../components/wizard/WizardContext";

const PROJECT = "proj_test";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  sessionStorage.clear();
});

function makeData(overrides: Partial<WizardData> = {}): WizardData {
  return {
    creative_divergence: null,
    concept: null,
    story_dna: null,
    world: null,
    characters: null,
    novel_outline: null,
    chapter1_outline: null,
    chapter_outline_progress: null,
    ...overrides,
  };
}

function wrap({ children }: { children: ReactNode }) {
  return <WizardProvider projectId={PROJECT}>{children}</WizardProvider>;
}

describe("WizardContext", () => {
  it("starts at step 1 with empty data and idle status", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    expect(result.current.currentStep).toBe(1);
    expect(result.current.status).toBe("idle");
    expect(result.current.completedSteps).toEqual([]);
    expect(result.current.data).toEqual(makeData());
  });

  it("transitions to generating on startStep", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    expect(result.current.status).toBe("generating");
    expect(result.current.currentStep).toBe(1);
  });

  it("records completed steps and stores data on saveStep", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
        concept: {
          title: "X",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "", side_a: "", side_b: "" },
          value_stack: [],
        },
      })
    );
    expect(result.current.status).toBe("completed");
    expect(result.current.completedSteps).toContain(1);
    expect(result.current.data.concept?.title).toBe("X");
    expect(result.current.currentStep).toBe(2);
  });

  it("jumpToStep allows navigation back to a completed step", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
        concept: {
          title: "X",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "", side_a: "", side_b: "" },
          value_stack: [],
        },
      })
    );
    act(() => result.current.jumpToStep(1));
    expect(result.current.currentStep).toBe(1);
    expect(result.current.status).toBe("completed");
  });

  it("skipStep marks step as skipped and advances", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(4));
    act(() => result.current.skipStep(4));
    expect(result.current.completedSteps).toContain(4);
    expect(result.current.currentStep).toBe(5);
  });

  it("persists currentStep, completedSteps, data to sessionStorage under project-scoped key", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
        concept: {
          title: "Persisted",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "", side_a: "", side_b: "" },
          value_stack: [],
        },
      })
    );
    const stored = JSON.parse(sessionStorage.getItem(KEY)!);
    expect(stored.currentStep).toBe(2);
    expect(stored.completedSteps).toContain(1);
    expect(stored.data.concept.title).toBe("Persisted");
  });

  it("does not leak state between different projects", () => {
    sessionStorage.setItem(
      getSessionKey("proj_A"),
      JSON.stringify({
        currentStep: 6,
        completedSteps: [1, 2, 3, 4, 5],
        status: "completed",
        data: makeData(),
        errorMessage: null,
      })
    );
    function wrapB({ children }: { children: ReactNode }) {
      return <WizardProvider projectId="proj_B">{children}</WizardProvider>;
    }
    const { result } = renderHook(() => useWizard(), { wrapper: wrapB });
    expect(result.current.currentStep).toBe(1);
    expect(result.current.completedSteps).toEqual([]);
  });

  it("hydrates from sessionStorage on mount", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 3,
        completedSteps: [1, 2],
        status: "completed",
        data: makeData({
          concept: {
            title: "Hydrated",
            genre: "cool_novel",
            premise: "",
            tone: "",
            theme: "",
            target_audience: "",
            style_template: "",
          },
          story_dna: {
            core_contradiction: { statement: "", side_a: "", side_b: "" },
            value_stack: [],
          },
        }),
        errorMessage: null,
      })
    );
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    expect(result.current.currentStep).toBe(3);
    expect(result.current.completedSteps).toEqual([1, 2]);
    expect(result.current.data.concept?.title).toBe("Hydrated");
  });

  it("hydrateFromFiles merges completedSteps + data without changing currentStep backwards", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.hydrateFromFiles([1, 2, 3], {
        concept: {
          title: "From File",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "", side_a: "", side_b: "" },
          value_stack: [],
        },
      })
    );
    expect(result.current.completedSteps).toEqual([1, 2, 3]);
    expect(result.current.currentStep).toBe(1); // prefill marks steps completed but does not advance — resume uses sessionStorage's currentStep
    expect(result.current.data.concept?.title).toBe("From File");
  });

  it("hydrateFromFiles is additive (does not overwrite a step the user just completed)", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.saveStep(1, {
        concept: {
          title: "Just Done",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "", side_a: "", side_b: "" },
          value_stack: [],
        },
      })
    );
    act(() =>
      result.current.hydrateFromFiles([1, 2, 3], {
        world: {
          era: "X",
          geography: "Y",
          power_systems: [],
          factions: [],
          core_rules: [],
        },
      })
    );
    expect(result.current.completedSteps).toEqual([1, 2, 3]); // 1 stays
    expect(result.current.data.concept?.title).toBe("Just Done");
    expect(result.current.data.world?.era).toBe("X");
  });

  it("resets all state and clears project-scoped sessionStorage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() => result.current.reset());
    expect(result.current.currentStep).toBe(1);
    expect(result.current.status).toBe("idle");
    expect(result.current.completedSteps).toEqual([]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("resave (step already in completedSteps) keeps completedSteps ≤ saved step and clears data keys for steps > saved step", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // First-time saves for 2..7, then a resave of step 4.
    act(() => result.current.saveStep(2, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(3, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(4, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.skipStep(5));
    act(() => result.current.saveStep(6, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(7, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    // Resave step 4 with new patch data.
    act(() => result.current.saveStep(4, { characters: { characters: [{ id: "y" }], current: null } }));
    expect(result.current.completedSteps).toEqual([2, 3, 4]);
    expect(result.current.data.world?.era).toBe("W");                  // step 3 preserved
    expect(result.current.data.characters?.characters?.[0]?.id).toBe("y"); // step 4 patch applied
    expect(result.current.data.novel_outline).toBeNull();              // step 6 cleared
    expect(result.current.data.chapter1_outline).toBeNull();           // step 7 cleared
    expect(result.current.data.chapter_outline_progress).toBeNull();   // step 7 cleared
    expect(result.current.currentStep).toBe(5);
  });

  it("resave of step 5 clears step 6 chapter_outline_progress (regression: missing from STEP_DATA_KEY_TO_STEP)", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    // Simulate a partially-completed chapter-outline batch from a prior run.
    act(() => result.current.updateData({
      chapter_outline_progress: { done: 3, total: 10, last_user_modifications: "" },
    }));
    expect(result.current.data.chapter_outline_progress?.done).toBe(3);
    // Resaving step 5 should clear step 6's chapter_outline_progress so the
    // user doesn't see stale mid-batch progress when the next step 6 attempt
    // starts fresh.
    act(() => result.current.saveStep(5, {
      novel_outline: { core_conflict_theme: "t2", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" },
    }));
    expect(result.current.data.chapter_outline_progress).toBeNull();
    expect(result.current.data.chapter1_outline).toBeNull();
  });

  it("resave of step 2 clears data for steps 3..7 and keeps only concept/story_dna", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(2, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(3, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(4, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.saveStep(6, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(7, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(2, {
      concept: { title: "C2", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    expect(result.current.completedSteps).toEqual([2]);
    expect(result.current.data.concept?.title).toBe("C2");
    expect(result.current.data.world).toBeNull();
    expect(result.current.data.characters).toBeNull();
    expect(result.current.data.novel_outline).toBeNull();
    expect(result.current.data.chapter1_outline).toBeNull();
    expect(result.current.data.chapter_outline_progress).toBeNull();
  });

  it("resave of the last step (7) is benign — no subsequent steps to clear", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(2, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(3, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(4, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.skipStep(5));
    act(() => result.current.saveStep(6, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(7, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(7, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T2", scene_plan: [] }] } }));
    expect(result.current.completedSteps).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.current.data.chapter1_outline?.chapters?.[0]?.title).toBe("T2");
  });

  // v1.8.1: regression for design-doc F1.8.1.2 — lock independent
  // preservation of story_dna vs concept across hydrate and partial save.
  it("hydrateFromFiles preserves top-level story_dna independent of concept", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.hydrateFromFiles([2], {
        concept: {
          title: "X",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
        story_dna: {
          core_contradiction: { statement: "灭世与守护", side_a: "灭世者", side_b: "守护者" },
          value_stack: [],
        },
      })
    );
    // Both fields must reach display intact — never merge one into the other.
    expect(result.current.data.concept?.title).toBe("X");
    expect(result.current.data.story_dna?.core_contradiction.statement).toBe("灭世与守护");
    expect(result.current.data.story_dna?.core_contradiction.side_a).toBe("灭世者");
    expect(result.current.data.story_dna?.core_contradiction.side_b).toBe("守护者");
  });

  // v1.8.4: handleStart() in each step component generates content (LLM
  // call) and writes it directly to backend, but does NOT advance the
  // user's wizard position — the user clicks "下一步" to confirm. Without
  // markStepGenerated, the generated content reaches `data` (via the
  // component's local state) but `completedSteps` is never updated, so
  // when the user navigates away and back, the step is unreachable
  // (PROJ_proj_cc4ca4ae_report: step 6 became grayed out).
  it("markStepGenerated adds step to completedSteps and writes data, without advancing currentStep", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(2));
    act(() =>
      result.current.markStepGenerated(2, {
        world: {
          era: "Generated",
          geography: "World",
          power_systems: [],
          factions: [],
          core_rules: [],
        },
      })
    );
    expect(result.current.completedSteps).toContain(2);
    expect(result.current.data.world?.era).toBe("Generated");
    expect(result.current.currentStep).toBe(2); // NOT advanced — user must click "下一步"
    expect(result.current.status).toBe("completed");
  });

  it("markStepGenerated is idempotent (calling twice does not duplicate or corrupt completedSteps)", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(5));
    act(() =>
      result.current.markStepGenerated(5, {
        novel_outline: {
          core_conflict_theme: "first",
          volumes: [],
          mc_growth_arc: [],
          key_plot_points: [],
          generated_at: "",
          updated_at: "",
        },
      })
    );
    act(() =>
      result.current.markStepGenerated(5, {
        novel_outline: {
          core_conflict_theme: "second",
          volumes: [],
          mc_growth_arc: [],
          key_plot_points: [],
          generated_at: "",
          updated_at: "",
        },
      })
    );
    expect(result.current.completedSteps).toEqual([5]);
    expect(result.current.data.novel_outline?.core_conflict_theme).toBe("second");
  });

  it("saveStep with only concept patch leaves story_dna intact", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // Seed story_dna first via hydrate (covers the realistic path: user
    // resumes from saved files, then edits concept only).
    act(() =>
      result.current.hydrateFromFiles([2], {
        story_dna: {
          core_contradiction: { statement: "旧矛盾", side_a: "A", side_b: "B" },
          value_stack: [],
        },
      })
    );
    act(() => result.current.startStep(2));
    act(() =>
      result.current.saveStep(2, {
        concept: {
          title: "新标题",
          genre: "cool_novel",
          premise: "",
          tone: "",
          theme: "",
          target_audience: "",
          style_template: "",
        },
      })
    );
    expect(result.current.data.concept?.title).toBe("新标题");
    // story_dna must be untouched by the partial patch.
    expect(result.current.data.story_dna?.core_contradiction.statement).toBe("旧矛盾");
    expect(result.current.data.story_dna?.core_contradiction.side_a).toBe("A");
    expect(result.current.data.story_dna?.core_contradiction.side_b).toBe("B");
  });

  // v1.2 (creative-divergence refactor): step 1 (Creative Divergence) is
  // broken into 5 sequential sub-screens. The sub-step state is purely a
  // sub-position inside step 1; changing it must NOT touch currentStep or
  // any of the per-step wizard fields.
  it("starts at sub-stage A", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    expect(result.current.creativeDivergenceSubStage).toBe("A");
  });

  it("setCreativeDivergenceSubStage changes sub-stage without touching currentStep", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() => result.current.setCreativeDivergenceSubStage("B"));
    expect(result.current.creativeDivergenceSubStage).toBe("B");
    expect(result.current.currentStep).toBe(1);
    // Sanity: status is "generating" from startStep, not reset.
    expect(result.current.status).toBe("generating");
  });

  it("jumpToCreativeDivergence atomically sets currentStep=1 and the sub-stage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // Move away from step 1 first.
    act(() => result.current.startStep(3));
    expect(result.current.currentStep).toBe(3);
    // Jump back to step 1 at sub-stage D.
    act(() => result.current.jumpToCreativeDivergence("D"));
    expect(result.current.currentStep).toBe(1);
    expect(result.current.creativeDivergenceSubStage).toBe("D");
  });

  it("setActiveStep1Surface updates activeStep1Surface and sets currentStep=1", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.jumpToStep(3));
    expect(result.current.currentStep).toBe(3);
    act(() => result.current.setActiveStep1Surface("canvas"));
    expect(result.current.activeStep1Surface).toBe("canvas");
    expect(result.current.currentStep).toBe(1);
  });

  it("markStep1SurfaceCompleted adds surface and pushes 1 into completedSteps", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.markStep1SurfaceCompleted("canvas"));
    expect(result.current.completedStep1Surfaces).toEqual(["canvas"]);
    expect(result.current.completedSteps).toContain(1);
  });

  it("markStep1SurfaceCompleted is idempotent per surface", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.markStep1SurfaceCompleted("canvas"));
    act(() => result.current.markStep1SurfaceCompleted("canvas"));
    expect(result.current.completedStep1Surfaces).toEqual(["canvas"]);
    expect(result.current.completedSteps.filter((s) => s === 1)).toEqual([1]);
  });

  it("hydrateStep1Surfaces merges with existing via Set dedup", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.markStep1SurfaceCompleted("canvas"));
    act(() => result.current.hydrateStep1Surfaces(["divergence", "canvas"]));
    expect(result.current.completedStep1Surfaces.sort()).toEqual(["canvas", "divergence"]);
  });

  it("persists activeStep1Surface and completedStep1Surfaces to sessionStorage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.setActiveStep1Surface("canvas"));
    act(() => result.current.markStep1SurfaceCompleted("canvas"));
    const stored = JSON.parse(sessionStorage.getItem(KEY) || "{}");
    expect(stored.activeStep1Surface).toBe("canvas");
    expect(stored.completedStep1Surfaces).toEqual(["canvas"]);
  });

  it("restores activeStep1Surface and completedStep1Surfaces from sessionStorage", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 1,
        completedSteps: [1],
        status: "idle",
        data: makeData(),
        errorMessage: null,
        creativeDivergenceSubStage: "A",
        activeStep1Surface: "canvas",
        completedStep1Surfaces: ["canvas"],
      }),
    );
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    expect(result.current.activeStep1Surface).toBe("canvas");
    expect(result.current.completedStep1Surfaces).toEqual(["canvas"]);
  });

  it("isStep1EffectivelyCompleted returns true when any surface done", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // WizardState isn't exported, so build a minimal state object and
    // cast. The helper only reads completedStep1Surfaces; the rest of
    // the fields come from the live hook snapshot so the object stays
    // faithful to the real shape.
    const stateFrom = (surfaces: readonly string[]) =>
      ({
        activeStep1Surface: result.current.activeStep1Surface,
        completedStep1Surfaces: surfaces,
        currentStep: result.current.currentStep,
        completedSteps: result.current.completedSteps,
        status: "idle",
        data: makeData(),
        errorMessage: null,
        creativeDivergenceSubStage: "A",
        regenerateState: { kind: "idle" },
        prefillComplete: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

    expect(result.current.completedStep1Surfaces).toEqual([]);
    expect(isStep1EffectivelyCompleted(stateFrom([]))).toBe(false);

    act(() => result.current.markStep1SurfaceCompleted("divergence"));

    expect(result.current.completedStep1Surfaces.length >= 1).toBe(true);
    expect(
      isStep1EffectivelyCompleted(
        stateFrom(result.current.completedStep1Surfaces),
      ),
    ).toBe(true);
  });
});
