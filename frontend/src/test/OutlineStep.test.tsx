import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateNovelOutline: vi.fn(),
    updateNovelOutline: vi.fn(),
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
        world: { era: "e", geography: "g", era_social_structure: "", era_cultural_history: "", power_system: { name: "", description: "", stages: [], core_rules: [], ceilings: [] }, factions: [], core_rules: [] },
        characters: { characters: [{ id: "p" }], current: null },
        novel_outline: null,
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
    await waitFor(() => expect(api.generateNovelOutline).toHaveBeenCalledWith(PROJECT));
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
});