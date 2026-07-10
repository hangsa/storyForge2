import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    advance: vi.fn(),
    generateOutline: vi.fn(),
    updateOutline: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
  },
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => mockNavigate };
});

const mockNavigate = vi.fn();

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { WizardProvider, getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE4" });
  (api.generateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.updateOutline as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  mockNavigate.mockReset();
  sessionStorage.clear();
});

function renderModal(projectId = PROJECT, onDismiss = vi.fn()) {
  return render(
    <MemoryRouter>
      <WizardProvider projectId={projectId}>
        <InitWizardModal projectId={projectId} onDismiss={onDismiss} />
      </WizardProvider>
    </MemoryRouter>
  );
}

function buildData() {
  return {
    concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
    story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
    world: null,
    characters: null,
    novel_outline: null,
    chapter1_outline: null,
  };
}

describe("InitWizardModal", () => {
  it("renders the step indicator with 6 steps", () => {
    renderModal();
    expect(screen.getByTestId("wizard-steps")).toBeInTheDocument();
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByTestId(`wizard-step-${i}`)).toBeInTheDocument();
    }
  });

  it("shows the close button but it is disabled", () => {
    renderModal();
    const closeBtn = screen.getByTestId("wizard-close");
    expect(closeBtn).toBeDisabled();
  });

  it("renders ConceptStep on mount (step 1)", () => {
    renderModal();
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
  });

  it("'上一步' is disabled on step 1", () => {
    renderModal();
    expect(screen.getByTestId("wizard-prev")).toBeDisabled();
  });

  it("clicking a step in the indicator jumps to that step", async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 2,
        completedSteps: [1],
        status: "completed",
        data: buildData(),
        errorMessage: null,
      }),
    );
    renderModal();
    expect(screen.getByTestId("world-step")).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("wizard-step-1").click();
    });
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
  });

  it("modal footer has NO forward navigation button (prevents duplicate '完成')", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 6,
        completedSteps: [1, 2, 3, 4, 5],
        status: "completed",
        data: buildData(),
        errorMessage: null,
      }),
    );
    renderModal();
    expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-next")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-finish")).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-prev")).not.toBeDisabled();
  });

  it("clicking '完成 → 进入工作台' on step 6 calls advance, resets wizard, and navigates", async () => {
    (api.generateOutline as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: [
        { chapter_number: 1, title: "第一章", summary: "开篇", scene_plan: [{ scene_id: "s1" }] },
      ],
    });
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 6,
        completedSteps: [1, 2, 3, 4, 5],
        status: "idle",
        data: buildData(),
        errorMessage: null,
      }),
    );
    const onDismiss = vi.fn();
    renderModal(PROJECT, onDismiss);
    expect(screen.getByTestId("chapter-outline-step")).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("chapter-outline-start").click();
    });
    await screen.findByTestId("chapter-outline-form");
    await act(async () => {
      screen.getByTestId("chapter-outline-finish").click();
    });
    await waitFor(() => expect(api.updateOutline).toHaveBeenCalled());
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith(PROJECT, "STAGE4"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/project/${encodeURIComponent(PROJECT)}/workspace?mode=manual`),
    );
    expect(onDismiss).toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});