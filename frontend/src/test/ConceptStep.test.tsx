import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    generateConcept: vi.fn(),
    updateConcept: vi.fn(),
  },
}));

import api from "../api/client";
import { WizardProvider, useWizard } from "../components/wizard/WizardContext";
import ConceptStep from "../components/wizard/ConceptStep";

beforeEach(() => {
  (api.generateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.updateConcept as ReturnType<typeof vi.fn>).mockReset();
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

describe("ConceptStep", () => {
  it("renders idle state with '开始生成' button initially", () => {
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    expect(screen.getByTestId("concept-step")).toBeInTheDocument();
    expect(screen.getByTestId("concept-start")).toBeInTheDocument();
    expect(screen.getByText("开始生成")).toBeInTheDocument();
  });

  it("clicking start calls generateConcept and shows completed form", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "P", tone: "n", theme: "t", target_audience: "a", style_template: "s" },
      story_dna: { core_contradiction: { statement: "C", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    await act(async () => {
      screen.getByTestId("concept-start").click();
    });
    expect(api.generateConcept).toHaveBeenCalledWith("proj_x");
    await waitFor(() => expect(screen.getByTestId("concept-form")).toBeInTheDocument());
    expect((screen.getByTestId("concept-title") as HTMLInputElement).value).toBe("T");
  });

  it("shows error banner when generation fails", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM 失败"));
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    await act(async () => {
      screen.getByTestId("concept-start").click();
    });
    expect(await screen.findByTestId("concept-error")).toHaveTextContent("LLM 失败");
  });

  it("'下一步' calls updateConcept and advances currentStep to 2", async () => {
    (api.generateConcept as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "T", genre: "cool_novel", premise: "P", tone: "n", theme: "t", target_audience: "a", style_template: "s" },
      story_dna: { core_contradiction: { statement: "C", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    (api.updateConcept as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(
      <WizardProvider projectId="proj_x">
        <Harness projectId="proj_x" />
      </WizardProvider>
    );
    await act(async () => {
      screen.getByTestId("concept-start").click();
    });
    await screen.findByTestId("concept-form");
    await act(async () => {
      screen.getByTestId("concept-next").click();
    });
    expect(api.updateConcept).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("current-step").textContent).toBe("2");
    });
  });
});
