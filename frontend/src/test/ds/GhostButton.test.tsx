import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GhostButton from "../../components/ds/GhostButton";

describe("GhostButton", () => {
  it("renders the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<GhostButton label="查看全部 →" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部 →" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses font-mono + on-surface-variant styling", () => {
    render(<GhostButton label="清空" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/font-mono/);
    expect(btn.className).toMatch(/text-on-surface-variant/);
  });

  it("is disabled when disabled prop is set", () => {
    render(<GhostButton label="清空" disabled onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});