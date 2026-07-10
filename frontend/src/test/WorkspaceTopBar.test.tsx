import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";

describe("WorkspaceTopBar", () => {
  it("shows project name", () => {
    render(<WorkspaceTopBar projectName="The Book" mode="manual" onModeChange={() => {}} />);
    expect(screen.getByTestId("topbar-project-name")).toHaveTextContent("The Book");
  });

  it("shows manual badge in manual mode", () => {
    render(<WorkspaceTopBar projectName="X" mode="manual" onModeChange={() => {}} />);
    expect(screen.getByTestId("topbar-mode-badge").textContent).toContain("手动");
  });

  it("shows managed badge in managed mode", () => {
    render(<WorkspaceTopBar projectName="X" mode="managed" onModeChange={() => {}} />);
    expect(screen.getByTestId("topbar-mode-badge").textContent).toMatch(/托管|暂停/);
  });

  it("forwards mode switcher changes to onModeChange", () => {
    const onModeChange = vi.fn();
    render(<WorkspaceTopBar projectName="X" mode="managed" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(onModeChange).toHaveBeenCalledWith("manual");
  });

  it("renders placeholder progress ring + disabled AI-tools button", () => {
    render(<WorkspaceTopBar projectName="X" mode="managed" onModeChange={() => {}} />);
    expect(screen.getByTestId("topbar-progress")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-ai-tools")).toBeDisabled();
  });
});