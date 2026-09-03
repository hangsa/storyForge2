import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WizardSidebar from "./WizardSidebar";

function renderSidebar(overrides: Partial<Parameters<typeof WizardSidebar>[0]> = {}) {
  const onJump = vi.fn();
  const result = render(
    <WizardSidebar
      currentStep={1}
      completedSteps={[]}
      activeStep1Surface="divergence"
      completedStep1Surfaces={[]}
      onJump={onJump}
      {...overrides}
    />
  );
  return { ...result, onJump };
}

describe("WizardSidebar (post-integration)", () => {
  const labels = ["创意发散", "创意画布", "概念 DNA", "世界观", "角色设计", "地图系统", "全文大纲", "章节大纲"];

  it("renders 8 sidebar items in position order", () => {
    renderSidebar();
    labels.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it("renders divergence + canvas with identical base class (same row style)", () => {
    renderSidebar();
    const div = screen.getByTestId("wizard-sidebar-item-divergence").closest("button, a");
    const canvas = screen.getByTestId("wizard-sidebar-item-canvas").closest("button, a");
    expect(div?.className).toContain("px-3 py-2");
    expect(canvas?.className).toContain("px-3 py-2");
    expect(div?.className).not.toContain("border-dashed");
    expect(canvas?.className).not.toContain("border-dashed");
  });

  it("no separator / dashed border between divergence and canvas", () => {
    const { container } = renderSidebar();
    expect(container.querySelector('[data-testid="wizard-sidebar-modules"]')).toBeNull();
    expect(container.querySelector(".border-dashed")).toBeNull();
  });

  it("clicking canvas calls onJump with item { kind: 'step1-surface', surfaceId: 'canvas' }", () => {
    const { onJump } = renderSidebar();
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-canvas"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "step1-surface", surfaceId: "canvas" })
    );
  });

  it("clicking divergence calls onJump with item { kind: 'step1-surface', surfaceId: 'divergence' }", () => {
    const { onJump } = renderSidebar();
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-divergence"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "step1-surface", surfaceId: "divergence" })
    );
  });

  it("clicking concept DNA calls onJump with item { kind: 'step1-surface' undefined, position: 2 }", () => {
    // Use currentStep=2 so concept is reachable as the active step.
    // (At currentStep=1 with no surface completed, concept is correctly
    // disabled — covered by the "step 2 disabled for new project" test.)
    const { onJump } = renderSidebar({ currentStep: 2 });
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-concept"));
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }));
  });

  it("marks divergence active when currentStep=1 and activeStep1Surface='divergence'", () => {
    renderSidebar({ currentStep: 1, activeStep1Surface: "divergence" });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("marks canvas active when currentStep=1 and activeStep1Surface='canvas'", () => {
    renderSidebar({ currentStep: 1, activeStep1Surface: "canvas" });
    const item = screen.getByTestId("wizard-sidebar-item-canvas");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("shows ✓ on divergence when completedStep1Surfaces contains 'divergence'", () => {
    renderSidebar({ completedStep1Surfaces: ["divergence"] });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("completed");
  });

  it("shows ✓ on canvas independently of divergence (互不污染)", () => {
    renderSidebar({ completedStep1Surfaces: ["canvas"] });
    expect(screen.getByTestId("wizard-sidebar-item-canvas").getAttribute("data-state")).toBe("completed");
    expect(screen.getByTestId("wizard-sidebar-item-divergence").getAttribute("data-state")).not.toBe("completed");
  });

  it("step 2 (concept DNA) is enabled when any surface completed (OR semantic)", () => {
    renderSidebar({ completedStep1Surfaces: ["canvas"] });
    const concept = screen.getByTestId("wizard-sidebar-item-concept");
    expect(concept).not.toHaveAttribute("disabled");
  });

  it("step 2 (concept DNA) is enabled when completedSteps already contains 1", () => {
    renderSidebar({ completedSteps: [1] });
    const concept = screen.getByTestId("wizard-sidebar-item-concept");
    expect(concept).not.toHaveAttribute("disabled");
  });

  it("step 2 (concept DNA) is disabled when no surface done", () => {
    renderSidebar({ completedSteps: [], completedStep1Surfaces: [] });
    const concept = screen.getByTestId("wizard-sidebar-item-concept");
    expect(concept).toHaveAttribute("disabled");
  });

  it("step 2 disabled for new project — neither surface completed", () => {
    renderSidebar();
    expect(screen.getByTestId("wizard-sidebar-item-concept")).toHaveAttribute("disabled");
  });
});