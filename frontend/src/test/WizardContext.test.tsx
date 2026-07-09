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
    expect(result.current.currentStep).toBe(4); // advances to one past max completed
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
});
