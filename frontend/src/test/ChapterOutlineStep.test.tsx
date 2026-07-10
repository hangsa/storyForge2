import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => mockNavigate };
});

vi.mock("../api/client", () => ({
  default: {
    generateOutline: vi.fn(),
    updateOutline: vi.fn(),
    advance: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE4" });
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  mockNavigate.mockReset();
  sessionStorage.clear();
});

function setup() {
  // Land the modal on step 6 (ChapterOutlineStep).
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] }, factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: { core_conflict_theme: "x", volumes: [], mc_growth_arc: [], key_plot_points: [], generated_at: "", updated_at: "" },
        chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter>,
  );
}

const SAMPLE_OUTLINE = {
  chapters: [
    { chapter_number: 1, title: "第一章", summary: "开篇", scene_plan: [{ scene_id: "s1" }] },
  ],
};

describe("ChapterOutlineStep", () => {
  it("auto-triggers generateOutline on mount (no '开始生成' button)", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    expect(screen.queryByTestId("chapter-outline-start")).not.toBeInTheDocument();
    await waitFor(() => expect(api.generateOutline).toHaveBeenCalledWith(PROJECT, 1));
  });

  it("after auto-trigger the form is shown with chapter title input", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    expect(await screen.findByTestId("chapter-outline-form")).toBeInTheDocument();
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe("第一章");
  });

  it("error state shows the error banner with no '重试' button; footer '重新生成' is enabled", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM 失败"));
    setup();
    expect(await screen.findByText(/LLM 失败/)).toBeInTheDocument();
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    const regen = await screen.findByTestId("wizard-regenerate");
    expect(regen).not.toBeDisabled();
  });

  it("'完成 → 进入工作台' calls updateOutline, advance, navigate", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_OUTLINE);
    setup();
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-outline-finish").click();
    });
    await waitFor(() => expect(api.updateOutline).toHaveBeenCalled());
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith(PROJECT, "STAGE4"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/project/${encodeURIComponent(PROJECT)}/workspace?mode=manual`),
    );
  });
});
