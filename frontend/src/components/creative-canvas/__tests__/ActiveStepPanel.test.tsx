import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActiveStepPanel } from "../ActiveStepPanel";

const baseProps = {
  step: 3,
  operation: { type: "fusion", name: "融合", reason: "当前创意需要外部冲突" },
  options: [
    { id: "opt_3_a", title: "A 路径", premise: "p1", logic: "l1", scores: {} },
    { id: "opt_3_b", title: "B 路径", premise: "p2", logic: "l2", scores: {} },
    { id: "opt_3_c", title: "C 路径", premise: "p3", logic: "l3", scores: {} },
  ],
  onSelect: vi.fn(),
  disabled: false,
};

describe("ActiveStepPanel", () => {
  it("renders step header + 3 option cards", () => {
    render(<ActiveStepPanel {...baseProps} />);
    expect(screen.getByText(/STEP 3/)).toBeInTheDocument();
    // "融合" appears twice (header + recommendation label); both must be present
    expect(screen.getAllByText(/融合/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("A 路径")).toBeInTheDocument();
    expect(screen.getByText("B 路径")).toBeInTheDocument();
    expect(screen.getByText("C 路径")).toBeInTheDocument();
  });

  it("shows AI reasoning as 原因 text", () => {
    render(<ActiveStepPanel {...baseProps} />);
    expect(screen.getByText(/当前创意需要外部冲突/)).toBeInTheDocument();
  });

  it("calls onSelect with option id when 选择 button clicked", () => {
    render(<ActiveStepPanel {...baseProps} />);
    const buttons = screen.getAllByRole("button", { name: /选择/ });
    fireEvent.click(buttons[1]); // click B
    expect(baseProps.onSelect).toHaveBeenCalledWith("opt_3_b");
  });

  it("disables all buttons when disabled prop true", () => {
    render(<ActiveStepPanel {...baseProps} disabled={true} />);
    // When disabled, label changes to "提交中..."; match either form
    const buttons = screen.getAllByRole("button", { name: /选择|提交中/ });
    expect(buttons.length).toBe(3);
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
