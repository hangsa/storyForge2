import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SecondaryButton from "../../components/ds/SecondaryButton";

describe("SecondaryButton", () => {
  it("renders the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<SecondaryButton label="删除" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses error colors when variant is destructive", () => {
    render(<SecondaryButton label="删除" variant="destructive" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/border-error-container/);
    expect(btn.className).toMatch(/text-error/);
  });

  it("uses default surface colors when variant is omitted", () => {
    render(<SecondaryButton label="取消" onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/border-outline-variant/);
    expect(btn.className).not.toMatch(/border-error-container/);
  });

  it("renders an icon when icon prop is provided", () => {
    render(<SecondaryButton label="删除" icon="delete" onClick={() => {}} />);
    expect(screen.getByText("delete")).toBeInTheDocument();
  });
});