import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockedGetProjectStatus = vi.fn().mockResolvedValue({ title: "T" });

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: mockedGetProjectStatus,
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    getConcept: vi.fn().mockResolvedValue({ concept: null, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({ characters: [] }),
    getNovelOutline: vi.fn().mockResolvedValue({}),
    updateOutline: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import WorkspacePage from "../pages/WorkspacePage";
import { useAutopilotSession } from "../hooks/useAutopilotSession";
import { ToastProvider } from "../hooks/useToast";

// Mutable state shared between ManagedDashboard and ManagedAIControlPanel —
// they each call useAutopilotSession() in their own subtree, so we need a
// single source of truth for `session` / `events` that both render paths
// read from. Tests can mutate `mockSession` / `mockEvents` and re-render to
// observe the change.
let mockSession: {
  state: "stopped" | "running" | "paused";
  current_task: { description: string; chapter?: number } | null;
  queue: Array<{ id: string; description: string }>;
  history: unknown[];
  config: null;
} = {
  state: "stopped",
  current_task: null,
  queue: [],
  history: [],
  config: null,
};
let mockEvents: Array<{ event: string; data: unknown; id?: number }> = [];

const startFn = vi.fn(async () => {
  mockSession = { ...mockSession, state: "running", current_task: { description: "writing ch7" } };
});
const stopFn = vi.fn(async () => {
  mockSession = { ...mockSession, state: "stopped", current_task: null };
});

function setup(initialPath: string) {
  const view = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, rerender: view.rerender };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mockedGetProjectStatus.mockClear();
  startFn.mockClear();
  stopFn.mockClear();
  mockSession = {
    state: "stopped",
    current_task: null,
    queue: [],
    history: [],
    config: null,
  };
  mockEvents = [];
  vi.mocked(useAutopilotSession).mockImplementation(() => ({
    session: mockSession,
    events: mockEvents,
    status: "idle",
    start: startFn,
    stop: stopFn,
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  }));
});

describe("Workspace integration", () => {
  it("default mode renders ManagedDashboard + ManagedAIControlPanel", () => {
    setup("/project/p1/workspace");
    expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("managed");
    expect(screen.getByTestId("managed-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("ai-control-panel")).toBeInTheDocument();
  });

  // v1.8.1: workspace enters in "stopped" managed state — user must opt in
  // to start the autopilot. Status strip (current task) stays hidden until
  // the user clicks "启动托管".
  it("managed mode defaults to autopilot stopped (no status strip, toggle shows 启动)", () => {
    setup("/project/p1/workspace");
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();
    const toggle = screen.getByTestId("autopilot-toggle");
    expect(toggle.textContent).toContain("启动");
  });

  it("clicking autopilot-toggle shows status strip and switches button to 停止", async () => {
    const { rerender } = setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("autopilot-toggle"));
    // start() is async; the mock updates mockSession synchronously but React
    // needs a render cycle to pick it up. Re-render the tree to mirror the
    // post-promise-resolve snapshot the real hook would have produced.
    await new Promise((r) => setTimeout(r, 50));
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    const toggle = screen.getByTestId("autopilot-toggle");
    expect(toggle.textContent).toContain("停止");
  });

  it("?mode=manual renders ChapterTreePanel + WritingArea + ContextPanel", () => {
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("manual");
    expect(screen.getByTestId("chapter-tree")).toBeInTheDocument();
    expect(screen.getByTestId("writing-area")).toBeInTheDocument();
    expect(screen.getByTestId("context-panel")).toBeInTheDocument();
  });

  it("clicking mode-manual in the top-bar opens the confirm modal", () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
  });

  it("clicking mode-managed in the top-bar opens the start modal", async () => {
    setup("/project/p1/workspace?mode=manual");
    fireEvent.click(screen.getByTestId("mode-managed"));
    // The start modal fetches its config via api.getAutopilotSession; wait
    // for the async load to flip `loaded` to true so the modal renders.
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
  });

  it("clicking a 'writing' chapter cell opens the take-over confirm modal (not direct switch)", () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("chapter-cell-4")); // chapter 4 is "writing" in mock state
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
    expect(localStorage.getItem("storyforge.workspace.mode")).toBeNull(); // still on managed
  });

  it("'立即接管' on take-over modal switches to manual + loads that chapter's first scene", async () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("chapter-cell-4"));
    // uncheck "等待完成" so we take over immediately
    const waitCheckbox = screen.getByTestId("confirm-wait-finish") as HTMLInputElement;
    fireEvent.change(waitCheckbox, { target: { checked: false } });
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("manual"),
    );
    expect(screen.getByTestId("writing-area")).toBeInTheDocument();
  });

  // Stage 2 Task 2.11 — full SSE event sequence across all 4 AI control tabs.
  // We mock useAutopilotSession directly (not the underlying EventSource) and
  // re-mock its return value before each sub-step, then re-render. Using
  // rerender() (not multiple setup() calls) avoids duplicate-element errors
  // and mirrors a real "state-update" feel.
  it("EventSource sequence updates all 4 AI control tabs", () => {
    // Step 1: default managed mode renders cleanly with no events yet.
    const { rerender } = setup("/project/p1/workspace");
    expect(screen.getByTestId("ai-control-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("status-strip")).not.toBeInTheDocument();

    // Step 2: switch session to running with a current task — triggers the
    // status strip in ManagedDashboard.
    mockSession = { ...mockSession, state: "running", current_task: { description: "writing ch7" } };
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    // decisions tab is default — no event cards yet.
    fireEvent.click(screen.getByTestId("ai-tab-decisions"));
    expect(screen.queryByTestId("event-card-task_complete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("event-card-circuit_open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("event-card-circuit_close")).not.toBeInTheDocument();

    // Step 3: feed a partial event sequence — all three decision cards appear.
    mockEvents = [
      { event: "task_start", data: { description: "writing ch7" }, id: 1 },
      { event: "circuit_open", data: { reason: "guard" }, id: 2 },
      { event: "queue_add", data: { id: "q1", description: "review" }, id: 3 },
      { event: "task_complete", data: { chapter: 7 }, id: 4 },
      { event: "circuit_close", data: {}, id: 5 },
    ];
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("ai-tab-decisions"));
    expect(screen.getByTestId("event-card-task_complete")).toBeInTheDocument();
    expect(screen.getByTestId("event-card-circuit_open")).toBeInTheDocument();
    expect(screen.getByTestId("event-card-circuit_close")).toBeInTheDocument();

    // Step 4: queue_add event + session.queue populated → queue tab shows q1.
    mockEvents = [
      ...mockEvents,
      { event: "queue_add", data: { id: "q1", description: "review" }, id: 6 },
    ];
    mockSession = { ...mockSession, queue: [{ id: "q1", description: "review" }] };
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("ai-tab-queue"));
    expect(screen.getByTestId("queue-item-q1")).toBeInTheDocument();

    // Step 5: task_fail event → checks tab renders the fail card.
    mockEvents = [
      ...mockEvents,
      { event: "task_fail", data: { reason: "x" }, id: 7 },
    ];
    rerender(
      <MemoryRouter initialEntries={["/project/p1/workspace"]}>
        <Routes>
          <Route path="*" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("ai-tab-checks"));
    expect(screen.getByTestId("event-card-task_fail")).toBeInTheDocument();

    // Step 6: intervene tab shows pause + stop actions.
    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    expect(screen.getByTestId("action-pause")).toBeInTheDocument();
    expect(screen.getByTestId("action-stop")).toBeInTheDocument();
  });
});
