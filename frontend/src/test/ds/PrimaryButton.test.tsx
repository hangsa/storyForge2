import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrimaryButton from "../../components/ds/PrimaryButton";

describe("PrimaryButton", () => {
  it("renders the label", () => {
    render(<PrimaryButton label="查询" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "查询" })).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="Go" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables click and shows spinner when loading", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="查询" loading onClick={onClick} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    // spinner replaces the icon (or label) — class-based check
    expect(btn.querySelector("svg, .animate-spin")).toBeInTheDocument();
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(<PrimaryButton label="查询" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an icon when icon prop is provided", () => {
    render(<PrimaryButton label="查询" icon="plus" onClick={() => {}} />);
    // plus icon renders as a material-symbols-outlined span
    expect(screen.getByText("plus")).toBeInTheDocument();
  });
});