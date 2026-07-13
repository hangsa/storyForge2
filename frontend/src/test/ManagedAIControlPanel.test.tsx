import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import { useAutopilotSession } from "../hooks/useAutopilotSession";
import ManagedAIControlPanel from "../components/workspace/ManagedAIControlPanel";

type UseAutopilotSessionReturnMock = ReturnType<typeof useAutopilotSession>;

const session = {
  project_id: "p",
  state: "running" as const,
  current_task: { description: "writing chapter 5" },
  queue: [{ id: "q1", description: "check villain motivation" }],
  history: [],
  config: null,
};

const events = [
  { event: "task_complete", data: { chapter: 4 }, id: 1 },
  { event: "circuit_open", data: { reason: "guard" }, id: 2 },
  { event: "task_fail", data: { reason: "coherence" }, id: 3 },
];

const buildHookReturn = (
  extras: { stop?: ReturnType<typeof vi.fn>; pause?: ReturnType<typeof vi.fn> } = {},
): UseAutopilotSessionReturnMock => ({
  session,
  events,
  status: "connected",
  start: vi.fn().mockResolvedValue(undefined),
  stop: extras.stop ?? vi.fn().mockResolvedValue(undefined),
  pause: extras.pause ?? vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
});

function renderPanel() {
  return render(
    <ToastProvider>
      <ManagedAIControlPanel projectId="p" />
    </ToastProvider>,
  );
}

describe("ManagedAIControlPanel", () => {
  beforeEach(() => {
    vi.mocked(useAutopilotSession).mockReturnValue(buildHookReturn());
  });

  it("renders all four tabs", () => {
    renderPanel();
    expect(screen.getByTestId("ai-tab-decisions")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-queue")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-checks")).toBeInTheDocument();
    expect(screen.getByTestId("ai-tab-intervene")).toBeInTheDocument();
  });

  it("'决策流' is the default active tab", () => {
    renderPanel();
    expect(screen.getByTestId("ai-tab-decisions").className).toContain("border-primary-container");
    expect(screen.getByTestId("ai-decisions-list")).toBeInTheDocument();
  });

  it("clicking each tab swaps the panel content", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-queue"));
    expect(screen.getByTestId("ai-queue-list")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-decisions-list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ai-tab-checks"));
    expect(screen.getByTestId("ai-checks-list")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    expect(screen.getByTestId("ai-intervene-actions")).toBeInTheDocument();
  });

  it("decisions tab shows task_complete + circuit_open cards", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-decisions"));
    expect(screen.getByTestId("event-card-task_complete")).toBeInTheDocument();
    expect(screen.getByTestId("event-card-circuit_open")).toBeInTheDocument();
  });

  it("queue tab lists session.queue items", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-queue"));
    expect(screen.getByText("check villain motivation")).toBeInTheDocument();
    expect(screen.getByTestId("queue-item-q1")).toBeInTheDocument();
  });

  it("checks tab lists task_fail events", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-checks"));
    expect(screen.getByTestId("event-card-task_fail")).toBeInTheDocument();
  });

  it("intervene tab pause/stop buttons call session methods", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAutopilotSession).mockReturnValue(buildHookReturn({ stop, pause }));
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    fireEvent.click(screen.getByTestId("action-pause"));
    fireEvent.click(screen.getByTestId("action-stop"));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("rollback action is disabled in v1.9 (v1.9.1 deferred)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-intervene"));
    const rollback = screen.getByTestId("action-rollback");
    expect(rollback).toBeDisabled();
    expect(rollback.title).toContain("v1.9.1");
  });

  it("renders empty queue message when session.queue is empty", () => {
    vi.mocked(useAutopilotSession).mockReturnValue({
      ...buildHookReturn(),
      session: { ...session, queue: [] },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("ai-tab-queue"));
    expect(screen.getByText("— 队列为空 —")).toBeInTheDocument();
  });
});
