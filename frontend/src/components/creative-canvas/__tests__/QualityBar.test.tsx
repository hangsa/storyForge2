import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityBar } from "../QualityBar";

describe("QualityBar", () => {
  it("renders 3 bars with labels 新颖度 / 冲突 / 故事潜力", () => {
    render(<QualityBar novelty={0.5} conflict={0.3} storyPotential={0.8} />);
    expect(screen.getByText("新颖度")).toBeInTheDocument();
    expect(screen.getByText("冲突")).toBeInTheDocument();
    expect(screen.getByText("故事潜力")).toBeInTheDocument();
  });

  it("scales 0-1 input to 0-100% width", () => {
    const { container } = render(
      <QualityBar novelty={0.42} conflict={1} storyPotential={0} />,
    );
    const fills = container.querySelectorAll("[style*='width']");
    expect(fills[0].getAttribute("style")).toContain("42%");
    expect(fills[1].getAttribute("style")).toContain("100%");
    expect(fills[2].getAttribute("style")).toContain("0%");
  });

  it("clamps out-of-range input to [0, 100]", () => {
    const { container } = render(
      <QualityBar novelty={5} conflict={-0.5} storyPotential={0.4} />,
    );
    const fills = container.querySelectorAll("[style*='width']");
    // 5 * 100 = 500 → clamped to 100
    expect(fills[0].getAttribute("style")).toContain("100%");
    // -0.5 * 100 = -50 → clamped to 0
    expect(fills[1].getAttribute("style")).toContain("0%");
  });
});