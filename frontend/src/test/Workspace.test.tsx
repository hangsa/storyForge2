import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Use vi.hoisted() so the mock factory can reference these mocks (the
// factory is hoisted above regular `const` declarations, so any non-hoisted
// reference evaluates to undefined at mock time).
const {
  mockedGetProjectStatus,
  mockedGetStage4Progress,
  mockedGetOutline,
} = vi.hoisted(() => ({
  mockedGetProjectStatus: vi.fn().mockResolvedValue({ title: "T" }),
  // Mirrors the backend's no-progress response: chapters=[] but total_chapters
  // is set (either from progress.json or, after the Pre-step, from
  // novel_outline.json). Tests that care about a specific total override
  // via mockResolvedValueOnce.
  mockedGetStage4Progress: vi
    .fn()
    .mockResolvedValue({ chapters: [], total_chapters: 0 }),
  mockedGetOutline: vi.fn().mockResolvedValue({ chapters: [] }),
}));

vi.mock("../api/client", () => ({
  default: {
    getProjectStatus: mockedGetProjectStatus,
    getStage4Progress: mockedGetStage4Progress,
    getOutline: mockedGetOutline,
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
        {/* WorkspacePage reads useParams<{ projectId }> — declare the route
            with a :projectId segment so MemoryRouter populates params. The
            "path *" branch below is a fallback for non-/project paths. */}
        <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        <Route path="*" element={<ToastProvider><WorkspacePage projectId="p1" /></ToastProvider>} />
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
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("status-strip")).toBeInTheDocument();
    const toggle = screen.getByTestId("autopilot-toggle");
    expect(toggle.textContent).toContain("停止");
  });

  it("?mode=manual renders ChapterTreePanel + WritingArea + ContextPanel", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        {
          chapter_number: 1,
          title: "第一章",
          scene_plan: [{ scene_number: 1 }],
        },
      ],
    });
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("manual");
    expect(screen.getByTestId("chapter-tree")).toBeInTheDocument();
    // Wait for getOutline to resolve + URL parse useEffect to pick chapter 1
    expect(await screen.findByTestId("writing-area")).toBeInTheDocument();
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

  it("clicking a 'writing' chapter cell opens the take-over confirm modal (not direct switch)", async () => {
    // Both WorkspacePage and WorkspaceTopBar call getStage4Progress on
    // mount, so we need TWO once-only overrides — one per caller.
    const chapter4 = [{ chapter_number: 4, status: "in_progress" }];
    mockedGetStage4Progress.mockResolvedValueOnce({ chapters: chapter4, total_chapters: 7 });
    mockedGetStage4Progress.mockResolvedValueOnce({ chapters: chapter4, total_chapters: 7 });
    setup("/project/p1/workspace");
    // The useEffect fetch is async; wait for chapter-cell-4 to render.
    expect(await screen.findByTestId("chapter-cell-4")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chapter-cell-4"));
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
    expect(localStorage.getItem("storyforge.workspace.mode")).toBeNull(); // still on managed
  });

  it("'立即接管' on take-over modal switches to manual + loads that chapter's first scene", async () => {
    const chapter4 = [{ chapter_number: 4, status: "in_progress" }];
    mockedGetStage4Progress.mockResolvedValueOnce({ chapters: chapter4, total_chapters: 7 });
    mockedGetStage4Progress.mockResolvedValueOnce({ chapters: chapter4, total_chapters: 7 });
    // Take-over drills down into the chapter tree (manual mode) — we need
    // chapter 4 to also be in the outline so a scene can be selected.
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 4, title: "第四章", scene_plan: [{ scene_number: 1 }] },
      ],
    });
    setup("/project/p1/workspace");
    expect(await screen.findByTestId("chapter-cell-4")).toBeInTheDocument();
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
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
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
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
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
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
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
          <Route path="/project/:projectId/workspace" element={<ToastProvider><WorkspacePage /></ToastProvider>} />
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

  it("new project with empty progress.json renders no chapter cells in managed mode", async () => {
    // Default mock returns { chapters: [] } — no chapter-cell-* should render.
    setup("/project/p1/workspace");
    // useEffect runs after mount; wait for it to settle.
    await waitFor(() => expect(mockedGetStage4Progress).toHaveBeenCalledWith("p1"));
    expect(screen.queryByTestId("chapter-cell-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-cell-2")).not.toBeInTheDocument();
  });

  it("TopBar progress ring shows the novel_outline-derived total (0 / 150) for new project", async () => {
    // Pre-step: backend now returns total_chapters=150 from novel_outline.json
    // even when progress.json is missing. The TopBar reads that field and
    // renders "0 / 150" — verifying the planned total reaches the user
    // instead of "0 / 1" (outline.json) or "0 / 0" (no fallback).
    // Both WorkspacePage and WorkspaceTopBar call getStage4Progress on mount.
    mockedGetStage4Progress.mockResolvedValue({ chapters: [], total_chapters: 150 });
    setup("/project/p1/workspace");
    // WorkspaceTopBar renders a progress element with the "X / Y" text.
    expect(await screen.findByTestId("topbar-progress")).toHaveTextContent("0 / 150");
  });

  it("manual mode renders chapter tree from getOutline (1 chapter, 4 scenes)", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        {
          chapter_number: 1,
          title: "第一章 瞳开幽闭",
          scene_plan: [
            { scene_number: 1 },
            { scene_number: 2 },
            { scene_number: 3 },
            { scene_number: 4 },
          ],
        },
      ],
    });
    setup("/project/p1/workspace?mode=manual");
    // ChapterTreePanel.tsx:81 already exposes data-testid={`chapter-${ch.chapter_number}`}
    // and line 96 exposes data-testid={`scene-${s.scene_id}`}. Our `scene_id`
    // derivation is `${chapter_number}-${scene_number}`, so the 4 scenes
    // for chapter 1 get test ids "scene-1-1" .. "scene-1-4".
    expect(await screen.findByTestId("chapter-1")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-1")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-2")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-3")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-4")).toBeInTheDocument();
  });
});
