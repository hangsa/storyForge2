import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SidebarToggleButton from "../components/layout/SidebarToggleButton";

describe("SidebarToggleButton", () => {
  it("renders a menu icon", () => {
    render(<SidebarToggleButton collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText("menu")).toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<SidebarToggleButton collapsed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("title/aria-label/aria-expanded reflect collapsed state", () => {
    const { rerender } = render(
      <SidebarToggleButton collapsed={false} onToggle={() => {}} />
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("title", "收起侧边栏");
    expect(btn).toHaveAttribute("aria-label", "收起侧边栏");
    expect(btn).toHaveAttribute("aria-expanded", "true");

    rerender(<SidebarToggleButton collapsed={true} onToggle={() => {}} />);
    expect(btn).toHaveAttribute("title", "展开侧边栏");
    expect(btn).toHaveAttribute("aria-label", "展开侧边栏");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
