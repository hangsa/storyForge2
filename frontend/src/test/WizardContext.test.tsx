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
    creative_divergence: null,
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

  // 2026-09-19 砍掉 Concept DNA 步骤(step 2)后,step 1 (创意发散)保存的不再是
  // concept/story_dna,而是 wizard 自带的 creative_divergence 字段(由
  // InitWizardModal 的 prefill 直接覆盖)。这里验证 saveStep(1, ...) 仍然记录
  // completedSteps[1] = true 并把 data.creative_divergence 写入。
  it("records completed steps and stores data on saveStep(1)", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
        creative_divergence: {
          variants: [],
          selected_id: null,
        },
      })
    );
    expect(result.current.status).toBe("completed");
    expect(result.current.completedSteps).toContain(1);
    expect(result.current.data.creative_divergence).toEqual({
      variants: [],
      selected_id: null,
    });
    expect(result.current.currentStep).toBe(2);
  });

  it("jumpToStep allows navigation back to a completed step", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(1));
    act(() =>
      result.current.saveStep(1, {
        creative_divergence: { variants: [], selected_id: null },
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
        creative_divergence: { variants: [], selected_id: "v1" },
      })
    );
    const stored = JSON.parse(sessionStorage.getItem(KEY)!);
    expect(stored.currentStep).toBe(2);
    expect(stored.completedSteps).toContain(1);
    expect(stored.data.creative_divergence.selected_id).toBe("v1");
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
          creative_divergence: { variants: [{ id: "v1" }], selected_id: "v1" },
        }),
        errorMessage: null,
      })
    );
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    expect(result.current.currentStep).toBe(3);
    expect(result.current.completedSteps).toEqual([1, 2]);
    expect(result.current.data.creative_divergence?.selected_id).toBe("v1");
  });

  it("hydrateFromFiles merges completedSteps + data without changing currentStep backwards", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.hydrateFromFiles([1, 2, 3], {
        creative_divergence: { variants: [], selected_id: null },
      })
    );
    expect(result.current.completedSteps).toEqual([1, 2, 3]);
    expect(result.current.currentStep).toBe(1);
    expect(result.current.data.creative_divergence?.selected_id).toBeNull();
  });

  it("hydrateFromFiles is additive (does not overwrite a step the user just completed)", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.saveStep(1, {
        creative_divergence: { variants: [], selected_id: "v_just_done" },
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
    expect(result.current.completedSteps).toEqual([1, 2, 3]);
    expect(result.current.data.creative_divergence?.selected_id).toBe("v_just_done");
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

  // 2026-09-19:resave of step 2 (世界) 现在清除 steps 3-7 数据(world /
  // characters / novel_outline / chapter1_outline / chapter_outline_progress)。
  // step 1 (creative_divergence) 数据不再因 resave step 2 触发清理。
  it("resave (step already in completedSteps) keeps completedSteps ≤ saved step and clears data keys for steps > saved step", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    // First-time saves for 1, 2, 3, then skip 4, save 5, save 6.
    act(() => result.current.saveStep(1, {
      creative_divergence: { variants: [], selected_id: null },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
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
    expect(result.current.data.chapter_outline_progress).toBeNull();   // step 6 cleared
    expect(result.current.currentStep).toBe(4);
  });

  it("resave of step 5 clears step 6 chapter_outline_progress", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      creative_divergence: { variants: [], selected_id: null },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.updateData({
      chapter_outline_progress: { done: 3, total: 10, last_user_modifications: "" },
    }));
    expect(result.current.data.chapter_outline_progress?.done).toBe(3);
    act(() => result.current.saveStep(5, {
      novel_outline: { core_conflict_theme: "t2", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" },
    }));
    expect(result.current.data.chapter_outline_progress).toBeNull();
    expect(result.current.data.chapter1_outline).toBeNull();
  });

  it("resave of step 2 clears data for steps 3..6 and keeps creative_divergence", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      creative_divergence: { variants: [], selected_id: "v1" },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(2, { world: {
      era: "W2", geography: "G2",
      power_systems: [], factions: [], core_rules: [],
    }}));
    expect(result.current.completedSteps).toEqual([1, 2]);
    expect(result.current.data.creative_divergence?.selected_id).toBe("v1");
    expect(result.current.data.world?.era).toBe("W2");
    expect(result.current.data.characters).toBeNull();
    expect(result.current.data.novel_outline).toBeNull();
    expect(result.current.data.chapter1_outline).toBeNull();
    expect(result.current.data.chapter_outline_progress).toBeNull();
  });

  it("resave of the last step (6) is benign — no subsequent steps to clear", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.saveStep(1, {
      creative_divergence: { variants: [], selected_id: null },
    }));
    act(() => result.current.saveStep(2, { world: {
      era: "W", geography: "G",
      power_systems: [], factions: [], core_rules: [],
    }}));
    act(() => result.current.saveStep(3, { characters: { characters: [{ id: "x" }], current: null } }));
    act(() => result.current.skipStep(4));
    act(() => result.current.saveStep(5, { novel_outline: { core_conflict_theme: "t", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T", scene_plan: [] }] } }));
    act(() => result.current.saveStep(6, { chapter1_outline: { chapters: [{ chapter_number: 1, title: "T2", scene_plan: [] }] } }));
    expect(result.current.completedSteps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.current.data.chapter1_outline?.chapters?.[0]?.title).toBe("T2");
  });

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
    expect(result.current.currentStep).toBe(2);
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

  it("saveStep with only world patch leaves characters intact", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() =>
      result.current.hydrateFromFiles([3], {
        characters: {
          characters: [{ id: "c1", name: "x" }],
          current: null,
        },
      })
    );
    act(() => result.current.startStep(2));
    act(() =>
      result.current.saveStep(2, {
        world: {
          era: "新纪元",
          geography: "G",
          power_systems: [],
          factions: [],
          core_rules: [],
        },
      })
    );
    expect(result.current.data.world?.era).toBe("新纪元");
    expect(result.current.data.characters?.characters?.[0]?.id).toBe("c1");
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
    expect(result.current.status).toBe("generating");
  });

  it("jumpToCreativeDivergence atomically sets currentStep=1 and the sub-stage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper: wrap });
    act(() => result.current.startStep(3));
    expect(result.current.currentStep).toBe(3);
    act(() => result.current.jumpToCreativeDivergence("D"));
    expect(result.current.currentStep).toBe(1);
    expect(result.current.creativeDivergenceSubStage).toBe("D");
  });
});
