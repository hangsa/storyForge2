import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PanelCard from "../../components/ds/PanelCard";

describe("PanelCard", () => {
  it("renders children", () => {
    render(<PanelCard><span>hello</span></PanelCard>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("uses md padding (p-4) by default", () => {
    const { container } = render(<PanelCard>x</PanelCard>);
    expect(container.firstChild).toHaveClass("p-4");
  });

  it("applies the requested padding size", () => {
    const { container: sm } = render(<PanelCard padding="sm">x</PanelCard>);
    expect(sm.firstChild).toHaveClass("p-3");
    const { container: lg } = render(<PanelCard padding="lg">x</PanelCard>);
    expect(lg.firstChild).toHaveClass("p-6");
  });

  it("fires onClick when interactive and clicked", () => {
    const onClick = vi.fn();
    render(<PanelCard interactive onClick={onClick}>x</PanelCard>);
    fireEvent.click(screen.getByText("x"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("adds cursor-pointer when interactive", () => {
    const { container } = render(<PanelCard interactive>x</PanelCard>);
    expect(container.firstChild).toHaveClass("cursor-pointer");
  });
});
