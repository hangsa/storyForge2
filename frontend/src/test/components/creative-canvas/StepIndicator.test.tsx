import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepIndicator } from "@/components/creative-canvas/StepIndicator";

describe("StepIndicator", () => {
  it("renders step number and operation in pill", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    expect(screen.getByText(/STEP 3 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText(/融合/)).toBeInTheDocument();
  });

  it("renders maxSteps progress dots", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    expect(screen.getAllByTestId(/^progress-dot-\d+$/)).toHaveLength(5);
  });

  it("marks dots before current as completed (primary + glow)", () => {
    render(<StepIndicator currentStep={3} maxSteps={5} operation="fusion" />);
    const dot1 = screen.getByTestId("progress-dot-1");
    const dot3 = screen.getByTestId("progress-dot-3");
    const dot4 = screen.getByTestId("progress-dot-4");
    expect(dot1.className).toMatch(/bg-primary/);
    expect(dot3.className).toMatch(/glow-active/);  // current
    expect(dot4.className).toMatch(/bg-surface-variant/);  // future
  });
});