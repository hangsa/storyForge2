import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasPreStepHint } from "@/components/plot-canvas/CanvasPreStepHint";

describe("CanvasPreStepHint", () => {
  it("renders the step number dynamically (default step=1)", () => {
    render(<CanvasPreStepHint />);
    // The "第 1 步" text must appear; exact wording is UI-polish, the
    // semantic invariant is that the step number is interpolated.
    // The step number is wrapped in a styled <span>, so we check the
    // container's textContent (concatenates across element boundaries).
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/第\s*1\s*步/);
  });

  it("honors the step prop (step=3 → 第 3 步)", () => {
    render(<CanvasPreStepHint step={3} />);
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/第\s*3\s*步/);
  });

  it("mentions 继续 / 推进 / 上方 to point users at the continue button", () => {
    render(<CanvasPreStepHint />);
    // The hint is pointless if it doesn't direct the user to click
    // 继续. Assert that the body text contains at least one such
    // cue word. Wording is intentionally flexible.
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/继续|推进|上方|旁边/);
  });

  it("mentions AI / 创意操作 / 推演 to explain what's being generated", () => {
    render(<CanvasPreStepHint />);
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/AI|创意|推演|操作|方向/);
  });
});