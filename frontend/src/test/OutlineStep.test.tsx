import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", async () => {
  // Preserve real ApiError so outlineGuardRetry can instanceof-check it.
  const actual = await vi.importActual<typeof import("../api/client")>(
    "../api/client",
  );
  return {
    ...actual,
    default: {
      generateNovelOutline: vi.fn(),
      updateNovelOutline: vi.fn(),
      getConcept: vi.fn(),
      getWorld: vi.fn(),
      getCharacter: vi.fn(),
      getNovelOutline: vi.fn(),
      getOutline: vi.fn(),
    },
  };
});

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

function setup() {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 5,
      completedSteps: [1, 2, 3, 4],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_systems: [{ name: "", description: "", stages: [], core_rules: [], ceilings: [] }], factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
        chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

const SAMPLE_OUTLINE = {
  core_conflict_theme: "x",
  volumes: [],
  mc_growth_arc: [],
  key_plot_points: [],
  generated_at: "",
  updated_at: "",
};

describe("OutlineStep", () => {
  it("auto-triggers generateNovelOutline on mount (no '开始生成' button)", async () => {
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    expect(screen.queryByTestId("outline-start")).not.toBeInTheDocument();
    // v1.9: auto-trigger passes "" as user_modifications by default.
    await waitFor(() => expect(api.generateNovelOutline).toHaveBeenCalledWith(PROJECT, ""));
  });

  it("after auto-trigger the completed form is shown", async () => {
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    expect(await screen.findByTestId("outline-form")).toBeInTheDocument();
  });

  it("error state shows the error banner with no '重试' button; footer '重新生成' is enabled", async () => {
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM 失败"));
    setup();
    expect(await screen.findByText(/LLM 失败/)).toBeInTheDocument();
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    const regen = await screen.findByTestId("wizard-regenerate");
    expect(regen).not.toBeDisabled();
  });

  it("'确认修改并继续' calls updateNovelOutline", async () => {
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    await screen.findByTestId("outline-form");
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateNovelOutline).toHaveBeenCalledTimes(1));
  });

  it("core_conflict_theme textarea is 5 rows tall (enriched description)", async () => {
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    const textarea = (await screen.findByTestId("outline-form")).querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea!.getAttribute("rows")).toBe("5");
  });

  it("renders every volume as editable inputs (name, chapter_range, summary, key_events)", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷 阴阳初现", chapter_range: "1-50", summary: "阴阳眼觉醒", key_events: ["事件A", "事件B"] },
        { name: "第二卷 暗界迷踪", chapter_range: "51-100", summary: "身世揭露", key_events: ["事件C"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const list = form.querySelector("[data-testid='outline-volumes']");
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll("[data-testid='outline-volume']");
    expect(items.length).toBe(2);
    const v0Name = items[0].querySelector("[data-testid='volume-name-0']") as HTMLInputElement | null;
    const v0Range = items[0].querySelector("[data-testid='volume-range-0']") as HTMLInputElement | null;
    const v0Summary = items[0].querySelector("[data-testid='volume-summary-0']") as HTMLTextAreaElement | null;
    const v0Event0 = items[0].querySelector("[data-testid='volume-event-0-0']") as HTMLInputElement | null;
    const v0Event1 = items[0].querySelector("[data-testid='volume-event-0-1']") as HTMLInputElement | null;
    expect(v0Name?.value).toBe("第一卷 阴阳初现");
    expect(v0Range?.value).toBe("1-50");
    expect(v0Summary?.value).toBe("阴阳眼觉醒");
    expect(v0Event0?.value).toBe("事件A");
    expect(v0Event1?.value).toBe("事件B");
    const v1Name = items[1].querySelector("[data-testid='volume-name-1']") as HTMLInputElement | null;
    expect(v1Name?.value).toBe("第二卷 暗界迷踪");
  });

  it("renders each key_event on its own row with per-row delete and an add button", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["事件A", "事件B", "事件C"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const volume = form.querySelector("[data-testid='outline-volume']") as HTMLElement;
    const eventRows = volume.querySelectorAll("[data-testid^='volume-event-0-']:not([data-testid$='-remove']):not([data-testid='add-volume-event-0'])");
    const eventInputs = volume.querySelectorAll("input[data-testid^='volume-event-0-']");
    expect(eventInputs.length).toBe(3);
    expect((eventInputs[0] as HTMLInputElement).value).toBe("事件A");
    expect((eventInputs[1] as HTMLInputElement).value).toBe("事件B");
    expect((eventInputs[2] as HTMLInputElement).value).toBe("事件C");
    expect(form.querySelector("[data-testid='add-volume-event-0']")).not.toBeNull();
    expect(form.querySelectorAll("[data-testid='volume-event-0-0-remove']").length).toBe(1);
  });

  it("adding a key_event appends an empty row to that volume's events", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["事件A"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    expect(form.querySelectorAll("input[data-testid^='volume-event-0-']").length).toBe(1);
    await act(async () => {
      screen.getByTestId("add-volume-event-0").click();
    });
    const inputs = form.querySelectorAll("input[data-testid^='volume-event-0-']");
    expect(inputs.length).toBe(2);
    expect((inputs[1] as HTMLInputElement).value).toBe("");
  });

  it("removing a key_event deletes its row", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["事件A", "事件B"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    expect(form.querySelectorAll("input[data-testid^='volume-event-0-']").length).toBe(2);
    await act(async () => {
      screen.getByTestId("volume-event-0-0-remove").click();
    });
    const inputs = form.querySelectorAll("input[data-testid^='volume-event-0-']");
    expect(inputs.length).toBe(1);
    expect((inputs[0] as HTMLInputElement).value).toBe("事件B");
  });

  it("typing into a key_event input then saving persists the edited event array", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["事件A"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const eventInput = form.querySelector("[data-testid='volume-event-0-0']") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(eventInput, { target: { value: "改写后的事件" } });
    });
    (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...rich,
      volumes: [{ name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["改写后的事件"] }],
    });
    await act(async () => {
      screen.getByTestId("wizard-save").click();
    });
    await waitFor(() => {
      const calls = (api.updateNovelOutline as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1].volumes[0].key_events).toEqual(["改写后的事件"]);
    });
  });

  it("editable input fields use text-sm (matching core_conflict), not text-xs", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [{ name: "v", chapter_range: "1", summary: "s", key_events: ["e"] }],
      mc_growth_arc: [{ label: "m", target_chapter_range: "1-30", description: "d" }],
      key_plot_points: [{ title: "p", must_appear_in_volume: "v", description: "d", trigger_chapter_hint: "h" }],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const coreTextarea = form.querySelector("textarea") as HTMLTextAreaElement;
    expect(coreTextarea.className).toContain("text-sm");
    expect(coreTextarea.className).not.toContain("text-xs");
    const checkInput = (testId: string) => {
      const el = form.querySelector(`[data-testid='${testId}']`) as HTMLElement;
      expect(el.className, `${testId} className`).toContain("text-sm");
      expect(el.className, `${testId} className`).not.toContain("text-xs");
      expect(el.className, `${testId} className`).not.toContain("font-body-narrative");
      expect(el.className, `${testId} className`).not.toContain("font-body-ui");
    };
    checkInput("volume-name-0");
    checkInput("volume-range-0");
    checkInput("volume-summary-0");
    checkInput("volume-event-0-0");
    checkInput("milestone-label-0");
    checkInput("milestone-range-0");
    checkInput("milestone-desc-0");
    checkInput("plot-title-0");
    checkInput("plot-volume-0");
    checkInput("plot-desc-0");
    checkInput("plot-hint-0");
  });

  it("typing into a volume name input then clicking '保存修改' persists the new value", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "原卷名", chapter_range: "1-30", summary: "原摘要", key_events: ["原事件"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const nameInput = form.querySelector("[data-testid='volume-name-0']") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "改名后的卷" } });
    });
    (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...rich,
      volumes: [{ name: "改名后的卷", chapter_range: "1-30", summary: "原摘要", key_events: ["原事件"] }],
    });
    await act(async () => {
      screen.getByTestId("wizard-save").click();
    });
    await waitFor(() => {
      const calls = (api.updateNovelOutline as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBe(PROJECT);
      expect(lastCall[1].volumes[0].name).toBe("改名后的卷");
    });
  });

  it("adding a volume appends an empty card with empty inputs", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [
        { name: "第一卷", chapter_range: "1-30", summary: "s", key_events: ["e"] },
      ],
      mc_growth_arc: [],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    expect(form.querySelectorAll("[data-testid='outline-volume']").length).toBe(1);
    await act(async () => {
      screen.getByTestId("add-volume-btn").click();
    });
    expect(form.querySelectorAll("[data-testid='outline-volume']").length).toBe(2);
    const newName = form.querySelector("[data-testid='volume-name-1']") as HTMLInputElement;
    expect(newName.value).toBe("");
  });

  it("mc_growth_arc renders editable inputs with milestone labels", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [],
      mc_growth_arc: [
        { label: "起点", target_chapter_range: "1-30", description: "凡人之身" },
        { label: "觉醒", target_chapter_range: "31-80", description: "异能觉醒" },
      ],
      key_plot_points: [],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const m0Label = form.querySelector("[data-testid='milestone-label-0']") as HTMLInputElement;
    const m0Range = form.querySelector("[data-testid='milestone-range-0']") as HTMLInputElement;
    const m0Desc = form.querySelector("[data-testid='milestone-desc-0']") as HTMLTextAreaElement;
    expect(m0Label?.value).toBe("起点");
    expect(m0Range?.value).toBe("1-30");
    expect(m0Desc?.value).toBe("凡人之身");
    const m1Label = form.querySelector("[data-testid='milestone-label-1']") as HTMLInputElement;
    expect(m1Label?.value).toBe("觉醒");
  });

  it("key_plot_points renders editable inputs with plot point titles", async () => {
    const rich = {
      core_conflict_theme: "x",
      volumes: [],
      mc_growth_arc: [],
      key_plot_points: [
        { title: "血月降临", must_appear_in_volume: "第一卷", description: "开篇引子", trigger_chapter_hint: "第1章" },
      ],
      generated_at: "",
      updated_at: "",
    };
    (api.generateNovelOutline as ReturnType<typeof vi.fn>).mockResolvedValue(rich);
    setup();
    const form = await screen.findByTestId("outline-form");
    const p0Title = form.querySelector("[data-testid='plot-title-0']") as HTMLInputElement;
    const p0Volume = form.querySelector("[data-testid='plot-volume-0']") as HTMLInputElement;
    const p0Desc = form.querySelector("[data-testid='plot-desc-0']") as HTMLTextAreaElement;
    const p0Hint = form.querySelector("[data-testid='plot-hint-0']") as HTMLInputElement;
    expect(p0Title?.value).toBe("血月降临");
    expect(p0Volume?.value).toBe("第一卷");
    expect(p0Desc?.value).toBe("开篇引子");
    expect(p0Hint?.value).toBe("第1章");
  });
});