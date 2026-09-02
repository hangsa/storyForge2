import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HorizontalPathCanvas } from "../HorizontalPathCanvas";
import type { CreativeStep } from "@/api/client";

const pathWithMixedStates: CreativeStep[] = [
  { step: 1, state: "completed", selected_option_id: "opt_1_a",
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 2, state: "completed", selected_option_id: "opt_2_b",
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 3, state: "active", selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 4, state: "available", selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
  { step: 5, state: "locked", selected_option_id: null,
    operation: null, operation_reason: null, options: [],
    created_at: "", selected_at: "", regenerated_count: 0 },
];

describe("HorizontalPathCanvas", () => {
  it("renders IDEA + 5 STEP cells", () => {
    render(<HorizontalPathCanvas rootIdea="长生者寻死" path={pathWithMixedStates} />);
    expect(screen.getByText("IDEA")).toBeInTheDocument();
    expect(screen.getByText(/STEP 1/)).toBeInTheDocument();
    expect(screen.getByText(/STEP 5/)).toBeInTheDocument();
  });

  it("shows 创意深度 N/5 in header", () => {
    render(<HorizontalPathCanvas rootIdea="p" path={pathWithMixedStates} />);
    expect(screen.getByText(/创意深度 2 \/ 5/)).toBeInTheDocument();
  });

  it("renders completed steps with ✓ checkmark", () => {
    const { container } = render(
      <HorizontalPathCanvas rootIdea="p" path={pathWithMixedStates} />
    );
    expect(container.querySelectorAll("[data-step-state='completed']").length).toBe(2);
    expect(container.querySelectorAll("[data-step-state='active']").length).toBe(1);
    expect(container.querySelectorAll("[data-step-state='available']").length).toBe(1);
    expect(container.querySelectorAll("[data-step-state='locked']").length).toBe(1);
  });

  it("renders empty state for empty path", () => {
    render(<HorizontalPathCanvas rootIdea="p" path={[]} />);
    expect(screen.getByText(/创意深度 0 \/ 5/)).toBeInTheDocument();
  });
});
