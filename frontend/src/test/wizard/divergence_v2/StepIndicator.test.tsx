import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepIndicator from "@/components/wizard/divergence_v2/StepIndicator";
import type { SubStage } from "@/components/wizard/divergence_v2/types";

describe("StepIndicator (3B)", () => {
  it("renders 3 stages", () => {
    render(
      <StepIndicator
        current="1"
        completed={[]}
        onJump={() => {}}
      />,
    );
    // Text is broken across nodes by `{s.key}. {s.label}` JSX, so use
    // a function matcher (Testing Library recommended pattern for split text).
    expect(screen.getByText((_, el) => el?.tagName === "BUTTON" && /输入灵感/.test(el.textContent ?? ""))).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "BUTTON" && /3B 发散/.test(el.textContent ?? ""))).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "BUTTON" && /深化提交/.test(el.textContent ?? ""))).toBeTruthy();
  });

  it("invokes onJump for completed stages only", () => {
    const onJump = vi.fn();
    render(
      <StepIndicator
        current="2"
        completed={["1"]}
        onJump={onJump}
      />,
    );
    fireEvent.click(screen.getByText((_, el) => el?.tagName === "BUTTON" && /输入灵感/.test(el.textContent ?? "")));
    expect(onJump).toHaveBeenCalledWith("1");

    onJump.mockReset();
    fireEvent.click(screen.getByText((_, el) => el?.tagName === "BUTTON" && /深化提交/.test(el.textContent ?? "")));
    expect(onJump).not.toHaveBeenCalled();
  });
});
