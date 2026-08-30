import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceTopBar from "./WorkspaceTopBar";

// Mock the autopilot SSE hook so TopBar doesn't try to open real EventSource
// connections (and pull in useToast/ToastProvider) during unit tests.
vi.mock("../../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(() => ({
    session: null,
    status: "idle",
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    refresh: vi.fn(),
    events: [],
  })),
}));

// Mock the api client so the component never hits the network.
vi.mock("../../api/client", () => ({
  default: {
    getStage4Progress: vi.fn().mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 0,
      total_chapters: 0,
      chapters: [],
      circuit_breaker_events: [],
    }),
    getOutline: vi.fn(),
  },
}));

describe("WorkspaceTopBar tab switching", () => {
  const baseProps = {
    projectId: "proj_x", projectName: "测试", mode: "manual" as const,
    onModeChange: vi.fn(), onOpenPlaza: vi.fn(), onOpenConsole: vi.fn(),
    activeTab: "settings" as const, onTabChange: vi.fn(), manuscriptLocked: false,
  };

  it("renders 项目设定 / 正文手稿 tabs", () => {
    render(<WorkspaceTopBar {...baseProps} />);
    expect(screen.getByText("项目设定")).toBeInTheDocument();
    expect(screen.getByText("正文手稿")).toBeInTheDocument();
  });

  it("disables 正文手稿 when manuscriptLocked is true", () => {
    render(<WorkspaceTopBar {...baseProps} manuscriptLocked={true} />);
    expect(screen.getByText("正文手稿").closest("button")).toBeDisabled();
  });

  it("calls onTabChange when unlocked tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<WorkspaceTopBar {...baseProps} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("正文手稿"));
    expect(onTabChange).toHaveBeenCalledWith("manuscript");
  });

  it("does NOT call onTabChange when locked tab is clicked", () => {
    const onTabChange = vi.fn();
    render(<WorkspaceTopBar {...baseProps} manuscriptLocked={true} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("正文手稿"));
    expect(onTabChange).not.toHaveBeenCalled();
  });
});