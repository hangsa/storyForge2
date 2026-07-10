import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../api/client", () => ({
  default: {
    generateConcept: vi.fn(),
    updateConcept: vi.fn(),
    advance: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
  },
}));

import api from "../api/client";
import { WizardProvider, useWizard } from "../components/wizard/WizardContext";
import ConceptStep from "../components/wizard/ConceptStep";
import InitWizardModal from "../components/wizard/InitWizardModal";

beforeEach(() => {
  (api.generateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.updateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockReset();
  (api.advance as ReturnType<typeof vi.fn>).mockResolvedValue({ current_stage: "STAGE2" });
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

function Harness({ projectId }: { projectId: string }) {
  const wizard = useWizard();
  return (
    <>
      <ConceptStep projectId={projectId} />
      <span data-testid="current-step">{wizard.currentStep}</span>
      <span data-testid="status">{wizard.status}</span>
      <button data-testid="reset" onClick={wizard.reset}>reset</button>
    </>
  );
}

// Renders the full InitWizardModal so the wizard-next footer button is
// available. The modal owns its own WizardProvider, so we assert on the
// observable side effect (api.advance) rather than on currentStep state.
function setupInModal() {
  return render(
    <MemoryRouter>
      <InitWizardModal projectId="proj_x" onDismiss={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("ConceptStep", () => {
  it("auto-triggers generateConcept on mount (no '开始生成' button)", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "P", tone: "n", theme: "t", target_audience: "a", style_template: "s" },
      story_dna: { core_contradiction: { statement: "C", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    expect(screen.queryByTestId("concept-start")).not.toBeInTheDocument();
    await waitFor(() => expect(api.generateConcept).toHaveBeenCalledWith("proj_x"));
  });

  it("after auto-trigger the completed form is shown populated", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "P", tone: "n", theme: "t", target_audience: "a", style_template: "s" },
      story_dna: { core_contradiction: { statement: "C", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    expect(await screen.findByTestId("concept-form")).toBeInTheDocument();
    expect((screen.getByTestId("concept-title") as HTMLInputElement).value).toBe("T");
  });

  it("error state shows the error banner with no '重试' button, but footer '重新生成' is enabled", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM 失败"));
    render(
      <MemoryRouter>
        <InitWizardModal projectId="proj_x" onDismiss={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("concept-error")).toHaveTextContent("LLM 失败");
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
    // Footer "重新生成" is the retry affordance; it's enabled when status is "error".
    const regen = await screen.findByTestId("wizard-regenerate");
    expect(regen).not.toBeDisabled();
  });

  it("'确认修改并继续' in modal footer calls updateConcept and advances to STAGE2 (no resave → steps 2..6 untouched)", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "P", tone: "n", theme: "t", target_audience: "a", style_template: "s" },
      story_dna: { core_contradiction: { statement: "C", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    (api.updateConcept as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    setupInModal();
    await screen.findByTestId("concept-form");
    await act(async () => {
      screen.getByTestId("wizard-next").click();
    });
    await waitFor(() => expect(api.updateConcept).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.advance).toHaveBeenCalledWith("proj_x", "STAGE2"));
  });
});
