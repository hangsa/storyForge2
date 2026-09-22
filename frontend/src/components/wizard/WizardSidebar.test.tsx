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
  // 2026-09-19 砍掉「概念 DNA」步骤后,v2.x 是 7 步:
  //   1. 创意发散 (divergence)    position 1
  //   2. 世界观   (world)         position 2
  //   3. 角色设计 (character)     position 3
  //   4. 地图系统 (map)           position 4
  //   5. 剧情画布 (plot)          position 5
  //   6. 全文大纲 (outline)       position 6
  //   7. 章节大纲 (chapter)       position 7
  const labels = [
    "创意发散",
    "世界观",
    "角色设计",
    "地图系统",
    "剧情画布",
    "全文大纲",
    "章节大纲",
  ];
  const ids = ["divergence", "world", "character", "map", "plot", "outline", "chapter"];

  it("renders 7 sidebar items in position order", () => {
    renderSidebar();
    labels.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it("renders all sidebar items with correct testids", () => {
    renderSidebar();
    ids.forEach((id) =>
      expect(screen.getByTestId(`wizard-sidebar-item-${id}`)).toBeInTheDocument()
    );
  });

  it("step 2 (world) is enabled when step 1 (divergence) is completed", () => {
    renderSidebar({ completedSteps: [1] });
    expect(screen.getByTestId("wizard-sidebar-item-world")).not.toHaveAttribute("disabled");
  });

  it("step 2 (world) is disabled for a new project", () => {
    renderSidebar();
    expect(screen.getByTestId("wizard-sidebar-item-world")).toHaveAttribute("disabled");
  });

  // The component's reachability rule is: a step N is enabled when N is the
  // immediately-next step (currentStep+1) AND currentStep is in completedSteps.
  // Steps further ahead are disabled until you walk through them in order.
  it("step 5 (plot) is enabled when currentStep=4 and step 4 is completed", () => {
    renderSidebar({ currentStep: 4, completedSteps: [1, 2, 3, 4] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).not.toHaveAttribute("disabled");
  });

  it("step 5 (plot) is disabled when currentStep=4 but step 4 is NOT completed", () => {
    renderSidebar({ currentStep: 4, completedSteps: [1, 2, 3] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).toHaveAttribute("disabled");
  });

  it("step 5 (plot) is disabled when currentStep=1 even with all earlier steps completed", () => {
    // Furthest-ahead steps aren't auto-unlocked; the user must walk through.
    renderSidebar({ currentStep: 1, completedSteps: [1, 2, 3, 4] });
    expect(screen.getByTestId("wizard-sidebar-item-plot")).toHaveAttribute("disabled");
  });

  // 2026-09-22:已完成步骤即使不在当前 step 之后也允许回跳。fix
  // proj_47738f64 案例(用户当前在 Step 3 无法点 Step 1)。
  it("completed steps are reachable from any later step (back-jump)", () => {
    renderSidebar({ currentStep: 3, completedSteps: [1, 2] });
    // Step 1 已完成,即使 currentStep=3 也允许点击回看
    expect(screen.getByTestId("wizard-sidebar-item-divergence")).not.toHaveAttribute("disabled");
    // Step 2 已完成也可点
    expect(screen.getByTestId("wizard-sidebar-item-world")).not.toHaveAttribute("disabled");
  });

  it("forceReachableSteps overrides completedSteps for steps the wizard forgot", () => {
    // 旧 sessionStorage 可能持久化空 completedSteps,但 divergence 实际已完成 —
    // WorkspaceWizardPanel 通过 forceReachableSteps=[1] 让 Step 1 仍可点。
    renderSidebar({ currentStep: 3, completedSteps: [], forceReachableSteps: [1] });
    expect(screen.getByTestId("wizard-sidebar-item-divergence")).not.toHaveAttribute("disabled");
  });

  it("marks divergence active when currentStep=1", () => {
    renderSidebar({ currentStep: 1 });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("marks plot active when currentStep=5", () => {
    renderSidebar({ currentStep: 5 });
    const item = screen.getByTestId("wizard-sidebar-item-plot");
    expect(item.getAttribute("data-state")).toBe("current");
  });

  it("marks step completed when in completedSteps and not current", () => {
    renderSidebar({ currentStep: 2, completedSteps: [1] });
    const item = screen.getByTestId("wizard-sidebar-item-divergence");
    expect(item.getAttribute("data-state")).toBe("completed");
  });

  it("clicking a reachable item calls onJump with the full SidebarItem", () => {
    // currentStep=4 with step 4 in completedSteps makes plot (position 5) the
    // immediately-next reachable step.
    const { onJump } = renderSidebar({ currentStep: 4, completedSteps: [1, 2, 3, 4] });
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-plot"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plot", label: "剧情画布", position: 5 })
    );
  });

  it("clicking a disabled (unreachable) item does NOT call onJump", () => {
    const { onJump } = renderSidebar();
    fireEvent.click(screen.getByTestId("wizard-sidebar-item-plot"));
    expect(onJump).not.toHaveBeenCalled();
  });
});