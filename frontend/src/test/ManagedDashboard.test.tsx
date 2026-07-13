import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const showMock = vi.fn();

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ show: showMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import { useAutopilotSession } from "../hooks/useAutopilotSession";
import ManagedDashboard from "../components/workspace/ManagedDashboard";

type SessionOverrides = {
  state?: "stopped" | "running" | "paused";
  current_task?: { description: string; chapter?: number } | null;
};

type UseAutopilotSessionReturnMock = ReturnType<typeof useAutopilotSession>;

const mockSession = (overrides: SessionOverrides = {}) => ({
  project_id: "p",
  state: ("running" as const),
  current_task: { description: "生成第 7 章" },
  queue: [],
  history: [],
  config: null,
  ...overrides,
});

const buildHookReturn = (
  overrides: SessionOverrides = {},
  extras: { start?: ReturnType<typeof vi.fn>; stop?: ReturnType<typeof vi.fn> } = {},
): UseAutopilotSessionReturnMock => ({
  session: mockSession(overrides),
  events: [],
  status: "connected",
  start: extras.start ?? vi.fn().mockResolvedValue(undefined),
  stop: extras.stop ?? vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
});

function renderDashboard(chapters = [
  { chapter_number: 1, status: "completed" as const },
  { chapter_number: 2, status: "writing" as const },
  { chapter_number: 3, status: "planned" as const },
  { chapter_number: 4, status: "pending" as const },
]) {
  return render(
    <ManagedDashboard
      projectId="p"
      chapters={chapters}
      onChapterClick={() => {}}
      onAddChapter={() => {}}
      onRefresh={() => {}}
    />,
  );
}

describe("ManagedDashboard", () => {
  beforeEach(() => {
    showMock.mockClear();
    vi.mocked(useAutopilotSession).mockReturnValue(buildHookReturn());
  });

  // v1.9: status strip driven by useAutopilotSession; visible only when
  // session.state === "running" AND current_task has a non-empty description.
  it("hides status strip when session.state !== 'running'", () => {
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ state: "stopped", current_task: null }),
    );
    renderDashboard();
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
  });

  it("shows status strip when session.state === 'running' and current_task is set", () => {
    renderDashboard();
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("status-strip").textContent).toContain("生成第 7 章");
  });

  it("hides status strip when running but current_task is null", () => {
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ current_task: null }),
    );
    renderDashboard();
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
  });

  it("hides status strip when current_task has empty description", () => {
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ current_task: { description: "" } }),
    );
    renderDashboard();
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
  });

  it("renders one cell per chapter with status color", () => {
    renderDashboard();
    const cell1 = screen.getByTestId("chapter-cell-1");
    const cell2 = screen.getByTestId("chapter-cell-2");
    expect(cell1.className).toMatch(/green|emerald/);
    expect(cell2.className).toMatch(/blue/);
  });

  it("clicking a cell fires onChapterClick with chapter_number", () => {
    const onChapterClick = vi.fn();
    render(
      <ManagedDashboard
        projectId="p"
        chapters={[
          { chapter_number: 1, status: "completed" as const },
          { chapter_number: 2, status: "writing" as const },
          { chapter_number: 3, status: "planned" as const },
          { chapter_number: 4, status: "pending" as const },
        ]}
        onChapterClick={onChapterClick}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("chapter-cell-3"));
    expect(onChapterClick).toHaveBeenCalledWith(3, "planned");
  });

  it("+ new chapter and refresh buttons call their handlers", () => {
    const onAdd = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ManagedDashboard
        projectId="p"
        chapters={[]}
        onChapterClick={() => {}}
        onAddChapter={onAdd}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId("add-chapter"));
    fireEvent.click(screen.getByTestId("refresh"));
    expect(onAdd).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  // v1.9: stopped → toggle button calls start() with default config.
  it("renders '▶ 启动托管' when stopped; clicking it calls session.start", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ state: "stopped", current_task: null }, { start }),
    );
    renderDashboard();
    const btn = screen.getByTestId("autopilot-toggle");
    expect(btn.textContent).toContain("启动");
    await userEvent.click(btn);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0]).toEqual({
      scope: "all_planned",
      cadence: "balanced",
      policy: "auto",
      notify: "milestones",
    });
  });

  // v1.9: running → toggle button calls stop().
  it("renders '⏸ 停止托管' when running; clicking it calls session.stop", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({}, { stop }),
    );
    renderDashboard();
    const btn = screen.getByTestId("autopilot-toggle");
    expect(btn.textContent).toContain("停止");
    await userEvent.click(btn);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // v1.9 review-C5 parity: surface start/stop failures via toast instead of
  // silently leaving the UI in an inconsistent state.
  it("toggle failure surfaces a toast instead of leaving UI unconfirmed", async () => {
    const start = vi.fn().mockRejectedValue(new Error("409 state conflict"));
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ state: "stopped", current_task: null }, { start }),
    );
    renderDashboard();
    await userEvent.click(screen.getByTestId("autopilot-toggle"));
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(showMock.mock.calls[0][0]).toContain("启动托管失败");
    expect(showMock.mock.calls[0][0]).toContain("409");
  });
});