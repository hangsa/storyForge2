import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SidebarNavItem from "../../components/ds/SidebarNavItem";

describe("SidebarNavItem", () => {
  it("renders the icon and label by default", () => {
    render(<SidebarNavItem icon="home" label="主页" />);
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("主页")).toBeInTheDocument();
  });

  it("applies active border + background when active", () => {
    const { container } = render(<SidebarNavItem icon="home" label="主页" active />);
    expect(container.firstChild).toHaveClass("border-primary");
    expect(container.firstChild).toHaveClass("bg-primary-container/15");
  });

  it("hides the label when collapsed", () => {
    render(<SidebarNavItem icon="home" label="主页" collapsed />);
    expect(screen.queryByText("主页")).not.toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<SidebarNavItem icon="home" label="主页" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});