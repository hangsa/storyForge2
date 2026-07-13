import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import { useAutopilotSession } from "../hooks/useAutopilotSession";
import type { ManagedStartConfig } from "../components/workspace/ManagedStartModal";
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
  start: (extras.start ?? vi.fn().mockResolvedValue(undefined)) as unknown as (
    cfg: ManagedStartConfig,
  ) => Promise<void>,
  stop: (extras.stop ?? vi.fn().mockResolvedValue(undefined)) as unknown as () => Promise<void>,
  pause: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
  resume: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
  refresh: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
});

describe("ManagedDashboard", () => {
  const chapters = [
    { chapter_number: 1, status: "completed" as const },
    { chapter_number: 2, status: "writing" as const },
    { chapter_number: 3, status: "planned" as const },
    { chapter_number: 4, status: "pending" as const },
  ];

  beforeEach(() => {
    vi.mocked(useAutopilotSession).mockReturnValue(buildHookReturn());
  });

  // v1.9: status strip now driven by useAutopilotSession; only visible when
  // session.state === "running" AND current_task is set.
  it("hides status strip when session.state !== 'running'", () => {
    vi.mocked(useAutopilotSession).mockReturnValue(
      buildHookReturn({ state: "stopped", current_task: null }),
    );
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />);
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
  });

  it("shows status strip when session.state === 'running' and current_task is set", () => {
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />);
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("status-strip").textContent).toContain("生成第 7 章");
  });

  it("renders one cell per chapter with status color", () => {
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />);
    const cell1 = screen.getByTestId("chapter-cell-1");
    const cell2 = screen.getByTestId("chapter-cell-2");
    expect(cell1.className).toMatch(/green|emerald/);
    expect(cell2.className).toMatch(/blue/);
  });

  it("clicking a cell fires onChapterClick with chapter_number", () => {
    const onChapterClick = vi.fn();
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={onChapterClick} onAddChapter={() => {}} onRefresh={() => {}} />);
    fireEvent.click(screen.getByTestId("chapter-cell-3"));
    expect(onChapterClick).toHaveBeenCalledWith(3, "planned");
  });

  it("+ new chapter and refresh buttons call their handlers", () => {
    const onAdd = vi.fn();
    const onRefresh = vi.fn();
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={onAdd} onRefresh={onRefresh} />);
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
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />);
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
    render(<ManagedDashboard projectId="p" chapters={chapters} onChapterClick={() => {}} onAddChapter={() => {}} onRefresh={() => {}} />);
    const btn = screen.getByTestId("autopilot-toggle");
    expect(btn.textContent).toContain("停止");
    await userEvent.click(btn);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
