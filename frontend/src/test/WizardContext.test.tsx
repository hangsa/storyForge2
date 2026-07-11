import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  WizardProvider,
  useWizard,
  getSessionKey,
  type WizardData,
} from "../components/wizard/WizardContext";

const PROJECT = "proj_test";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  sessionStorage.clear();
});

function makeData(overrides: Partial<WizardData> = {}): WizardData {
  return {
    concept: null,
    story_dna: null,
    world: null,
    characters: null,
    novel_outline: null,
    chapter1_outline: null,
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
          power_system: {
            name: "",
            description: "",
            stages: [],
            core_rules: [],
            ceilings: [],
          },
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
    // First-time saves for 1..6, then a resave of step 3.
    act(() => result.current.saveStep(1, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.skipStep(4));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    // Resave step 3 with new patch data.
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "y" }], current: null } }));
    expect(result.current.completedSteps).toEqual([1, 2, 3]);
    expect(result.current.data.world?.era).toBe("W");                  // step 2 preserved
    expect(result.current.data.characters?.characters?.[0]?.id).toBe("y"); // step 3 patch applied
    expect(result.current.data.novel_outline).toBeNull();              // step 5 cleared
    expect(result.current.data.chapter1_outline).toBeNull();           // step 6 cleared
    expect(result.current.currentStep).toBe(4);
  });

  it("resave of step 1 clears data for steps 2..6 and keeps only concept/story_dna", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(1, {
      concept: { title: "C2", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    expect(result.current.completedSteps).toEqual([1]);
    expect(result.current.data.concept?.title).toBe("C2");
    expect(result.current.data.world).toBeNull();
    expect(result.current.data.characters).toBeNull();
    expect(result.current.data.novel_outline).toBeNull();
    expect(result.current.data.chapter1_outline).toBeNull();
  });

  it("resave of the last step (6) is benign — no subsequent steps to clear", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      concept: { title: "C", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
      story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] },
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.skipStep(4));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T2", scene_plan: [] }] } }));
    expect(result.current.completedSteps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.current.data.chapter1_outline?.chapters?.[0]?.title).toBe("T2");
  });

  // v1.8.1: regression for design-doc F1.8.1.2 — lock independent
  // preservation of story_dna vs concept across hydrate and partial save.
  it("hydrateFromFiles preserves top-level story_dna independent of concept", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.hydrateFromFiles([1], {
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

  it("saveStep with only concept patch leaves story_dna intact", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // Seed story_dna first via hydrate (covers the realistic path: user
    // resumes from saved files, then edits concept only).
    act(() =>
      result.current.hydrateFromFiles([1], {
        story_dna: {
          core_contradiction: { statement: "旧矛盾", side_a: "A", side_b: "B" },
          value_stack: [],
        },
      })
    );
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
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
});
