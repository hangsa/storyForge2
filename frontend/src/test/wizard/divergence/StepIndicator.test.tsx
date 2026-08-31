import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepIndicator, { type SubStage } from "@/components/wizard/divergence/StepIndicator";

describe("StepIndicator", () => {
  it("renders 5 step labels", () => {
    render(<StepIndicator current="A" completed={[]} onJump={() => {}} />);
    expect(screen.getByText(/输入/)).toBeInTheDocument();
    expect(screen.getByText(/变体/)).toBeInTheDocument();
    expect(screen.getByText(/矛盾/)).toBeInTheDocument();
    expect(screen.getByText(/展开/)).toBeInTheDocument();
    expect(screen.getByText(/提交/)).toBeInTheDocument();
  });

  it("highlights current stage", () => {
    render(<StepIndicator current="C" completed={["A", "B"]} onJump={() => {}} />);
    const currentBtn = screen.getByTestId("step-C");
    expect(currentBtn.className).toMatch(/bg-primary/);
  });

  it("marks completed stages as clickable", () => {
    const onJump = vi.fn();
    render(<StepIndicator current="E" completed={["A", "B", "C", "D"]} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("step-A"));
    expect(onJump).toHaveBeenCalledWith("A");
  });

  it("disables unvisited stages", () => {
    const onJump = vi.fn();
    render(<StepIndicator current="A" completed={[]} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("step-C"));
    expect(onJump).not.toHaveBeenCalled();
  });
});