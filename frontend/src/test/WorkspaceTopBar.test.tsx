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

  // v1.8.1: workspace is now top-level — TopBar must offer a way back to /.
  it("renders a '← 项目中心' back button that navigates to /", () => {
    const assignSpy = vi.fn();
    const original = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    try {
      render(<WorkspaceTopBar projectName="X" mode="managed" onModeChange={() => {}} />);
      const back = screen.getByTestId("topbar-back-home");
      expect(back).toBeInTheDocument();
      fireEvent.click(back);
      expect(assignSpy).toHaveBeenCalledWith("/");
    } finally {
      Object.defineProperty(window, "location", {
        value: { ...window.location, assign: original },
        writable: true,
      });
    }
  });
});