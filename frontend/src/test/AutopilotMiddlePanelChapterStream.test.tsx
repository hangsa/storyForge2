import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/* Mock useChapterStream to a controllable handle. */
let lastHookReturn: any = null;
vi.mock("../hooks/useChapterStream", () => ({
  useChapterStream: () => lastHookReturn,
}));

/* Mock useAutopilotSession + API to a stopped session for a clean cockpit. */
const fakeSession = {
  project_id: "p", state: "running" as const,
  current_task: {
    description: "write_scene",
    kind: "write_scene",
    chapter_number: 17,
    scene_id: "17-2",
    progress_pct: 42,
  },
  queue: [
    { id: "w-17-3", kind: "write_scene", chapter_number: 17,
      payload: { scene_number: 3 }, description: "write 17-3" },
  ],
  history: [],
  config: { scope: "all_planned", cadence: "balanced",
            policy: "auto", notify: "milestones" },
};

/* Mock useToast — AutopilotMiddlePanel calls it at mount; no ToastProvider in test. */
vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: () => ({
    session: fakeSession,
    events: [],
    status: "connected",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

import AutopilotMiddlePanel from "../components/workspace/AutopilotMiddlePanel";

beforeEach(() => {
  lastHookReturn = null;
});

describe("AutopilotMiddlePanel with ChapterStreamPanel", () => {
  it("renders ChapterStreamPanel when stream.current is set", async () => {
    lastHookReturn = {
      text: "夜风如刀", lastSeq: 1, active: true, failed: false,
      error: null, charCount: 4, current: { chapter: 17, scene: 2 },
    };
    render(<AutopilotMiddlePanel projectId="p" />);
    // Default tab is "cockpit"; panel should be present.
    const panel = await screen.findByTestId("chapter-stream-panel");
    expect(panel.textContent).toContain("夜风如刀");
    expect(panel.textContent).toContain("第 17 章 第 2 场景");
  });

  it("does not render ChapterStreamPanel when no stream ever started", () => {
    lastHookReturn = {
      text: "", lastSeq: 0, active: false, failed: false,
      error: null, charCount: 0, current: null,
    };
    render(<AutopilotMiddlePanel projectId="p" />);
    expect(screen.queryByTestId("chapter-stream-panel")).toBeNull();
  });

  it("projects the panel inside the cockpit tab only (not on dashboard tab)", async () => {
    lastHookReturn = {
      text: "alpha", lastSeq: 1, active: true, failed: false,
      error: null, charCount: 5, current: { chapter: 1, scene: 1 },
    };
    render(<AutopilotMiddlePanel projectId="p" />);
    expect(screen.queryByTestId("chapter-stream-panel")).not.toBeNull();

    // Switch to dashboard tab; panel must unmount along with CockpitView
    const dashTab = screen.getByTestId("autopilot-tab-dashboard");
    dashTab.click();
    await waitFor(() => {
      expect(screen.queryByTestId("chapter-stream-panel")).toBeNull();
    });
  });
});
