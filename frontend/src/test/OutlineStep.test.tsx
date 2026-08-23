import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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

  it("renders every volume with name, chapter_range, summary, and key_events", async () => {
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
    expect(items[0].textContent).toContain("第一卷 阴阳初现");
    expect(items[0].textContent).toContain("1-50");
    expect(items[0].textContent).toContain("阴阳眼觉醒");
    expect(items[0].textContent).toContain("事件A");
    expect(items[0].textContent).toContain("事件B");
    expect(items[1].textContent).toContain("第二卷 暗界迷踪");
    expect(items[1].textContent).toContain("51-100");
  });
});