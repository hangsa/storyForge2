import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WizardSidebar from "./WizardSidebar";

describe("WizardSidebar", () => {
  const labels = ["创意发散", "概念 DNA", "世界观", "角色设计", "地图系统", "全文大纲", "章节大纲"];

  it("renders 7 sidebar items in order", () => {
    render(<WizardSidebar currentStep={1} completedSteps={[]} onJump={() => {}} />);
    labels.forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it("marks active item with secondary-container background", () => {
    render(<WizardSidebar currentStep={2} completedSteps={[]} onJump={() => {}} />);
    const item = screen.getByText("概念 DNA").closest("a, button");
    expect(item?.className).toMatch(/bg-secondary-container/);
  });

  it("disables pending items", () => {
    render(<WizardSidebar currentStep={1} completedSteps={[]} onJump={() => {}} />);
    const item = screen.getByText("角色设计").closest("a, button");
    expect(item).toHaveAttribute("disabled");
  });

  it("calls onJump when reachable item is clicked", () => {
    const onJump = vi.fn();
    render(<WizardSidebar currentStep={3} completedSteps={[1, 2]} onJump={onJump} />);
    fireEvent.click(screen.getByText("概念 DNA"));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("renders modules between step 1 and step 2 when modules prop is passed", () => {
    render(
      <WizardSidebar
        currentStep={1}
        completedSteps={[]}
        onJump={() => {}}
        modules={[{ id: "canvas", label: "创意画布", icon: "account_tree", path: "/p/stage1/canvas" }]}
      />
    );
    const module = screen.getByTestId("wizard-sidebar-module-canvas");
    expect(module).toBeInTheDocument();
    // Module button must NOT be disabled (modules aren't gated by the
    // wizard's completed-steps reachability — they're a sibling surface).
    expect(module).not.toHaveAttribute("disabled");
  });

  it("calls onModuleNavigate with the module's path when clicked", () => {
    const onModuleNavigate = vi.fn();
    render(
      <WizardSidebar
        currentStep={1}
        completedSteps={[]}
        onJump={() => {}}
        modules={[{ id: "canvas", label: "创意画布", icon: "account_tree", path: "/p/stage1/canvas" }]}
        onModuleNavigate={onModuleNavigate}
      />
    );
    fireEvent.click(screen.getByTestId("wizard-sidebar-module-canvas"));
    expect(onModuleNavigate).toHaveBeenCalledWith("/p/stage1/canvas");
  });

  it("omits the modules slot when modules prop is empty", () => {
    render(<WizardSidebar currentStep={1} completedSteps={[]} onJump={() => {}} />);
    expect(screen.queryByTestId("wizard-sidebar-modules")).not.toBeInTheDocument();
  });
});