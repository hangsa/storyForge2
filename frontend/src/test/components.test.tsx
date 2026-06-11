import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GlassPanel from "../components/shared/GlassPanel";
import NarrativeChip from "../components/shared/NarrativeChip";
import ProgressBar from "../components/shared/ProgressBar";

describe("GlassPanel", () => {
  it("renders children", () => {
    render(<GlassPanel>Hello World</GlassPanel>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<GlassPanel className="custom-class">Content</GlassPanel>);
    const el = container.firstElementChild;
    expect(el).toHaveClass("glass-panel");
    expect(el).toHaveClass("custom-class");
  });
});

describe("NarrativeChip", () => {
  it("renders label and value", () => {
    render(<NarrativeChip label="类型" value="仙侠" />);
    expect(screen.getByText("类型")).toBeInTheDocument();
    expect(screen.getByText("仙侠")).toBeInTheDocument();
  });

  it("applies default primary color", () => {
    const { container } = render(<NarrativeChip label="T" value="V" />);
    const chip = container.firstElementChild;
    expect(chip).toHaveClass("bg-primary-container/10");
  });

  it("applies error color variant", () => {
    const { container } = render(<NarrativeChip label="禁忌" value="背叛" color="error" />);
    const chip = container.firstElementChild;
    expect(chip).toHaveClass("bg-error-p0/10");
  });
});

describe("ProgressBar", () => {
  it("renders with correct width percentage", () => {
    const { container } = render(<ProgressBar value={75} max={100} label="进度" />);
    expect(screen.getByText("进度")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    const bar = container.querySelector("[style]");
    expect(bar).toHaveStyle({ width: "75%" });
  });

  it("handles 0 value", () => {
    const { container } = render(<ProgressBar value={0} />);
    const bar = container.querySelector("[style]");
    expect(bar).toHaveStyle({ width: "0%" });
  });

  it("clamps to max 100", () => {
    const { container } = render(<ProgressBar value={150} max={100} />);
    const bar = container.querySelector("[style]");
    expect(bar).toHaveStyle({ width: "100%" });
  });
});
