import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WizardSidebar from "./WizardSidebar";

function renderSidebar(overrides: Partial<Parameters<typeof WizardSidebar>[0]> = {}) {
  const onJump = vi.fn();
  const result = render(
    <WizardSidebar
      currentStep={1}
      completedSteps={[]}
      onJump={onJump}
      {...overrides}
    />
  );
  return { ...result, onJump };
}

describe("WizardSidebar (post-integration)", () => {
  // Display order matches the SIDEBAR_ITEMS list in WizardSidebar.tsx:
  //   1. 创意发散 (divergence)
  //   2. 概念 DNA (concept)
  //   3. 世界观 (world)
  //   4. 角色设计 (character)
  //   5. 地图系统 (map)
  //   6. 剧情画布 (plot)
  //   7. 全文大纲 (outline)
  //   8. 章节大纲 (chapter)
  const labels = [
    "创意发散",
    "概念 DNA",
    "世界观",
    "角色设计",
    "地图系统",
    "剧情画布",
    "全文大纲",
    "章节大纲",
  ];
  const ids = ["divergence", "concept", "world", "character", "map", "plot", "outline", "chapter"];

  it("renders 8 sidebar items in position order", () => {
    renderSidebar();
    labels.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it("renders all sidebar items with correct testids", () => {
    renderSidebar();
    ids.forEach((id) =>
      expect(screen.getByTestId(`wizard-sidebar-item-${id}`)).toBeInTheDocument()
    );
  });

  it("step 2 (concept DNA) is enabled when step 1 (divergence) is completed", () => {
    renderSidebar({ completedSteps: [1] });
    expect(screen.getByTestId("wizard-sidebar-item-concept")).not.toHaveAttribute("disabled");
  });

  it("step 2 (concept DNA) is disabled for a new project", () => {
    renderSidebar();
    expect(screen.getByTestId("wizard-sidebar-item-concept")).toHaveAttribute("disabled");
  });

  // The component's reachability rule is: a step N is enabled when N is the
  // immediately-next step (currentStep+1) AND currentStep is in completedSteps.
  // Steps further ahead are disabled until you walk through them in order.
  it("step 6 (plot) is enabled when currentStep=5 and step 5 is completed", () => {
    renderSidebar({ currentStep: 5, completedSteps: [1, 2, 3, 4, 5] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).not.toHaveAttribute("disabled");
  });

  it("step 6 (plot) is disabled when currentStep=5 but step 5 is NOT completed", () => {
    renderSidebar({ currentStep: 5, completedSteps: [1, 2, 3, 4] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).toHaveAttribute("disabled");
  });

  it("step 6 (plot) is disabled when currentStep=1 even with all earlier steps completed", () => {
    // Furthest-ahead steps aren't auto-unlocked; the user must walk through.
    renderSidebar({ currentStep: 1, completedSteps: [1, 2, 3, 4, 5] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).toHaveAttribute("disabled");
  });

  it("marks divergence active when currentStep=1", () => {
    renderSidebar({ currentStep: 1 });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("marks plot active when currentStep=6", () => {
    renderSidebar({ currentStep: 6 });
    const item = screen.getByTestId("wizard-sidebar-item-plot");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("marks step completed when in completedSteps and not current", () => {
    renderSidebar({ currentStep: 2, completedSteps: [1] });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("completed");
  });

  it("clicking a reachable item calls onJump with the full SidebarItem", () => {
    // currentStep=5 with step 5 in completedSteps makes plot (position 6) the
    // immediately-next reachable step.
    const { onJump } = renderSidebar({ currentStep: 5, completedSteps: [1, 2, 3, 4, 5] });
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-plot"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plot", label: "剧情画布", position: 6 })
    );
  });

  it("clicking a disabled (unreachable) item does NOT call onJump", () => {
    const { onJump } = renderSidebar();
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-plot"));
    expect(onJump).not.toHaveBeenCalled();
  });
});