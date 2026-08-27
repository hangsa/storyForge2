import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PhaseIndicator from "../../components/ds/PhaseIndicator";

const PHASES = [
  { key: "init", label: "初始化", count: 1 },
  { key: "stage1", label: "概念", count: 2, active: true },
  { key: "stage2", label: "世界观", count: 0, completed: true },
];

describe("PhaseIndicator", () => {
  it("renders every phase label and count", () => {
    render(<PhaseIndicator phases={PHASES} />);
    expect(screen.getByText("初始化")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("概念")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("marks the active phase with ring + animate-pulse", () => {
    const { container } = render(<PhaseIndicator phases={PHASES} />);
    const markers = container.querySelectorAll("span.bg-primary.rounded-full");
    expect(markers.length).toBeGreaterThan(0);
    const activeMarker = Array.from(markers).find((m) =>
      m.classList.contains("animate-pulse")
    );
    expect(activeMarker).toBeTruthy();
  });

  it("marks completed phases with bg-primary (solid)", () => {
    const { container } = render(<PhaseIndicator phases={PHASES} />);
    const completedMarker = container.querySelector(".bg-primary:not(.animate-pulse)");
    expect(completedMarker).toBeTruthy();
  });

  it("fires onPhaseClick with the clicked phase key", () => {
    const onPhaseClick = vi.fn();
    render(<PhaseIndicator phases={PHASES} onPhaseClick={onPhaseClick} />);
    fireEvent.click(screen.getByText("概念"));
    expect(onPhaseClick).toHaveBeenCalledWith("stage1");
  });
});
