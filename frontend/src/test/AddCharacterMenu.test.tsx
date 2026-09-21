import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddCharacterMenu } from "../components/shared/AddCharacterMenu";

describe("AddCharacterMenu", () => {
  const TYPES: Array<{ value: "protagonist" | "antagonist" | "supporting" | "mentor"; label: string }> = [
    { value: "protagonist", label: "主角" },
    { value: "antagonist", label: "反派" },
    { value: "supporting", label: "配角" },
    { value: "mentor", label: "导师" },
  ];

  it("renders 4 type options with testids", () => {
    render(<AddCharacterMenu onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("character-add-protagonist")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-antagonist")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-supporting")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-mentor")).toBeInTheDocument();
  });

  it("clicking an option fires onPick with the matching type", () => {
    const onPick = vi.fn();
    render(<AddCharacterMenu onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("character-add-antagonist"));
    expect(onPick).toHaveBeenCalledWith("antagonist");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop fires onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<AddCharacterMenu onPick={vi.fn()} onClose={onClose} />);
    // Backdrop is the first child div (fixed inset-0 z-40).
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape fires onClose", () => {
    const onClose = vi.fn();
    render(<AddCharacterMenu onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables all option buttons when disabled=true", () => {
    render(<AddCharacterMenu onPick={vi.fn()} onClose={vi.fn()} disabled />);
    for (const t of TYPES) {
      expect(screen.getByTestId(`character-add-${t.value}`)).toBeDisabled();
    }
  });
});