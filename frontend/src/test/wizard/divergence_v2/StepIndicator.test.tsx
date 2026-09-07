import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepIndicator } from "@/components/wizard/divergence_v2/StepIndicator";

describe("StepIndicator (4 stages)", () => {
  it("renders 4 stage buttons", () => {
    render(<StepIndicator current="1" completed={[]} onStageClick={vi.fn()} />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-4")).toBeInTheDocument();
  });

  it("completed stages are clickable", () => {
    const onClick = vi.fn();
    render(<StepIndicator current="3" completed={["1", "2", "3"]} onStageClick={onClick} />);
    fireEvent.click(screen.getByTestId("step-indicator-1"));
    expect(onClick).toHaveBeenCalledWith("1");
  });

  it("current stage is not clickable", () => {
    const onClick = vi.fn();
    render(<StepIndicator current="3" completed={["1", "2", "3"]} onStageClick={onClick} />);
    fireEvent.click(screen.getByTestId("step-indicator-3"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uncompleted stages are disabled", () => {
    render(<StepIndicator current="1" completed={[]} onStageClick={vi.fn()} />);
    expect(screen.getByTestId("step-indicator-4")).toBeDisabled();
  });
});
