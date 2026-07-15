import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";

// Mock the api client so the component never hits the network.
// Both getStage4Progress and getOutline are exposed so tests can assert
// that TopBar reads progress from getStage4Progress (NOT getOutline).
vi.mock("../api/client", () => ({
  default: {
    getStage4Progress: vi.fn(),
    getOutline: vi.fn(),
  },
}));

// Mock the autopilot SSE hook so TopBar doesn't try to open real EventSource
// connections during unit tests.
vi.mock("../hooks/useAutopilotSession", () => ({
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

import api from "../api/client";
import { useAutopilotSession } from "../hooks/useAutopilotSession";

const mockedGetStage4Progress = api.getStage4Progress as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetOutline = api.getOutline as unknown as ReturnType<typeof vi.fn>;
const mockedUseAutopilotSession = useAutopilotSession as unknown as ReturnType<
  typeof vi.fn
>;

describe("WorkspaceTopBar", () => {
  beforeEach(() => {
    mockedGetStage4Progress.mockReset();
    mockedGetOutline.mockReset();
    // Default: resolve to an empty progress so existing tests don't hang.
    mockedGetStage4Progress.mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 0,
      total_chapters: 0,
      chapters: [],
      circuit_breaker_events: [],
    });
  });

  it("shows project name", async () => {
    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="The Book"
        mode="manual"
        onModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("topbar-project-name")).toHaveTextContent(
        "The Book",
      );
    });
  });

  it("shows manual badge in manual mode", async () => {
    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="manual"
        onModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("topbar-mode-badge").textContent,
      ).toContain("手动");
    });
  });

  it("shows managed badge in managed mode", async () => {
    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="managed"
        onModeChange={() => {}}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("topbar-mode-badge").textContent,
      ).toMatch(/托管|暂停/);
    });
  });

  it("forwards mode switcher changes to onModeChange", async () => {
    const onModeChange = vi.fn();
    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="managed"
        onModeChange={onModeChange}
      />,
    );
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("mode-manual"));
    });
    expect(onModeChange).toHaveBeenCalledWith("manual");
  });

  it("renders disabled AI-tools button + back-home button", async () => {
    const assignSpy = vi.fn();
    const original = window.location.assign;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    try {
      render(
        <WorkspaceTopBar
          projectId="p"
          projectName="X"
          mode="managed"
          onModeChange={() => {}}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("topbar-progress")).toBeInTheDocument();
      });
      expect(screen.getByTestId("topbar-ai-tools")).toBeDisabled();
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

  it("progress ring reads from /stage4/progress (NOT getOutline)", async () => {
    mockedGetStage4Progress.mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 3,
      total_chapters: 10,
      chapters: [
        { chapter_number: 1, status: "completed", scenes: [] },
        { chapter_number: 2, status: "completed", scenes: [] },
        { chapter_number: 3, status: "completed", scenes: [] },
        { chapter_number: 4, status: "writing", scenes: [] },
        { chapter_number: 5, status: "planned", scenes: [] },
      ],
      circuit_breaker_events: [],
    });

    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="managed"
        onModeChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("topbar-progress")).toHaveTextContent(
        "3 / 10",
      );
    });
    expect(mockedGetStage4Progress).toHaveBeenCalledWith("p");
    // Critical: the TopBar must NOT query outline.json for progress.
    expect(mockedGetOutline).not.toHaveBeenCalled();
  });

  it("100% completion renders green progress", async () => {
    mockedGetStage4Progress.mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 3,
      total_chapters: 3,
      chapters: [
        { chapter_number: 1, status: "completed", scenes: [] },
        { chapter_number: 2, status: "completed", scenes: [] },
        { chapter_number: 3, status: "completed", scenes: [] },
      ],
      circuit_breaker_events: [],
    });

    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="managed"
        onModeChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("topbar-progress")).toHaveTextContent(
        "3 / 3",
      );
    });
    expect(
      screen.getByTestId("topbar-progress").getAttribute("data-color"),
    ).toBe("green");
  });

  it("in_progress chapters are NOT counted as completed", async () => {
    mockedGetStage4Progress.mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 1,
      total_chapters: 5,
      chapters: [
        { chapter_number: 1, status: "in_progress", scenes: [] },
        { chapter_number: 2, status: "pending", scenes: [] },
        { chapter_number: 3, status: "pending", scenes: [] },
        { chapter_number: 4, status: "pending", scenes: [] },
        { chapter_number: 5, status: "pending", scenes: [] },
      ],
      circuit_breaker_events: [],
    });

    render(
      <WorkspaceTopBar
        projectId="p"
        projectName="X"
        mode="managed"
        onModeChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("topbar-progress")).toHaveTextContent(
        "0 / 5",
      );
    });
    expect(
      screen.getByTestId("topbar-progress").getAttribute("data-color"),
    ).toBe("gray");
  });

  describe("mode-aware progress text", () => {
    beforeEach(() => {
      mockedUseAutopilotSession.mockReset();
    });

    it("manual mode hides 'AI 正在 ...' even when session is running", async () => {
      mockedUseAutopilotSession.mockReturnValue({
        session: {
          state: "running",
          current_task: { description: "write_scene (chapter 10)" },
        },
        status: "connected",
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        refresh: vi.fn(),
        events: [],
      });

      render(
        <WorkspaceTopBar
          projectId="p"
          projectName="X"
          mode="manual"
          onModeChange={() => {}}
        />,
      );

      // Wait for the progress element to render at all (avoid asserting on
      // a stale "—" from the pre-fetch state).
      await waitFor(() => {
        expect(screen.getByTestId("topbar-progress")).toBeInTheDocument();
      });
      const text = screen.getByTestId("topbar-progress").textContent ?? "";
      expect(text).not.toContain("AI 正在");
      expect(text).not.toContain("write_scene");
    });

    it("managed mode still shows 'AI 正在 ...' when session is running", async () => {
      mockedUseAutopilotSession.mockReturnValue({
        session: {
          state: "running",
          current_task: { description: "write_scene (chapter 10)" },
        },
        status: "connected",
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        refresh: vi.fn(),
        events: [],
      });

      render(
        <WorkspaceTopBar
          projectId="p"
          projectName="X"
          mode="managed"
          onModeChange={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("topbar-progress").textContent ?? "").toContain(
          "AI 正在 write_scene (chapter 10)",
        );
      });
    });

    it("manual mode still shows the progress count when session is idle", async () => {
      mockedUseAutopilotSession.mockReturnValue({
        session: { state: "stopped", current_task: null },
        status: "idle",
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        refresh: vi.fn(),
        events: [],
      });
      mockedGetStage4Progress.mockResolvedValue({
        project_id: "p",
        current_stage: "stage4",
        current_chapter: 3,
        total_chapters: 20,
        chapters: [
          { chapter_number: 1, status: "completed", scenes: [] },
          { chapter_number: 2, status: "completed", scenes: [] },
          { chapter_number: 3, status: "completed", scenes: [] },
          { chapter_number: 4, status: "pending", scenes: [] },
        ],
        circuit_breaker_events: [],
      });

      render(
        <WorkspaceTopBar
          projectId="p"
          projectName="X"
          mode="manual"
          onModeChange={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("topbar-progress")).toHaveTextContent(
          "3 / 20",
        );
      });
    });
  });
});
