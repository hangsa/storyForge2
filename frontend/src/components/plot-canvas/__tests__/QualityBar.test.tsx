import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityBar } from "../QualityBar";

describe("QualityBar", () => {
  it("renders 2 bars with labels Novelty + Conflict only", () => {
    render(<QualityBar novelty={0.5} conflict={0.3} />);
    expect(screen.getByText(/Novelty/)).toBeInTheDocument();
    expect(screen.getByText(/Conflict/)).toBeInTheDocument();
    // storyPotential dropped from design (2-stat display only)
    expect(screen.queryByText(/故事潜力/)).not.toBeInTheDocument();
  });

  it("scales 0-1 input to 0-100% width", () => {
    const { container } = render(<QualityBar novelty={0.42} conflict={1} />);
    const fills = container.querySelectorAll("[style*='width']");
    expect(fills[0].getAttribute("style")).toContain("42%");
    expect(fills[1].getAttribute("style")).toContain("100%");
  });

  it("clamps out-of-range input to [0, 100]", () => {
    const { container } = render(<QualityBar novelty={5} conflict={-0.5} />);
    const fills = container.querySelectorAll("[style*='width']");
    // 5 * 100 = 500 → clamped to 100
    expect(fills[0].getAttribute("style")).toContain("100%");
    // -0.5 * 100 = -50 → clamped to 0
    expect(fills[1].getAttribute("style")).toContain("0%");
  });
});