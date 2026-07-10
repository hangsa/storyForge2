import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkspaceModeSwitcher from "../components/workspace/WorkspaceModeSwitcher";

describe("WorkspaceModeSwitcher", () => {
  it("renders both segments", () => {
    render(<WorkspaceModeSwitcher mode="managed" onChange={() => {}} />);
    expect(screen.getByTestId("mode-managed")).toBeInTheDocument();
    expect(screen.getByTestId("mode-manual")).toBeInTheDocument();
  });

  it("highlights the active mode", () => {
    render(<WorkspaceModeSwitcher mode="manual" onChange={() => {}} />);
    expect(screen.getByTestId("mode-manual").className).toContain("bg-primary-container");
    expect(screen.getByTestId("mode-managed").className).not.toContain("bg-primary-container");
  });

  it("fires onChange with the new mode", () => {
    const onChange = vi.fn();
    render(<WorkspaceModeSwitcher mode="managed" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(onChange).toHaveBeenCalledWith("manual");
  });
});