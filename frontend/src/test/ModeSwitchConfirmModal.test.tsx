import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModeSwitchConfirmModal from "../components/workspace/ModeSwitchConfirmModal";

vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(),
}));

import { useAutopilotSession } from "../hooks/useAutopilotSession";

const DEFAULT_SESSION = {
  project_id: "p",
  state: "running" as const,
  current_task: { description: "生成当前章节" },
  queue: [],
  history: [],
  config: null,
};

const buildHookReturn = (session: typeof DEFAULT_SESSION | null = DEFAULT_SESSION) => ({
  session,
  events: [],
  status: "connected" as const,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
});

describe("ModeSwitchConfirmModal", () => {
  beforeEach(() => {
    vi.mocked(useAutopilotSession).mockReset();
    vi.mocked(useAutopilotSession).mockReturnValue(buildHookReturn());
  });

  it("renders when open and not in DOM when closed", () => {
    const { rerender } = render(
      <ModeSwitchConfirmModal projectId="p" open={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.queryByTestId("mode-switch-confirm")).not.toBeInTheDocument();
    rerender(
      <ModeSwitchConfirmModal projectId="p" open={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
  });

  it("renders mock AI state and queue summary", () => {
    vi.mocked(useAutopilotSession).mockReturnValueOnce(
      buildHookReturn({
        ...DEFAULT_SESSION,
        current_task: { description: "生成第 7 章" },
        queue: [
          { id: "q1", description: "a" },
          { id: "q2", description: "b" },
          { id: "q3", description: "c" },
          { id: "q4", description: "d" },
        ],
      }),
    );
    render(
      <ModeSwitchConfirmModal
        projectId="p"
        open={true}
        plannedChapters={12}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-current-task")).toHaveTextContent("生成第 7 章");
    expect(screen.getByTestId("confirm-queue").textContent).toContain("4");
    expect(screen.getByTestId("confirm-planned").textContent).toContain("12");
  });

  it("renders session.current_task.description (not hardcoded)", () => {
    vi.mocked(useAutopilotSession).mockReturnValueOnce(
      buildHookReturn({
        ...DEFAULT_SESSION,
        current_task: { description: "生成第 7 章" },
      }),
    );
    render(
      <ModeSwitchConfirmModal projectId="p" open={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId("confirm-current-task").textContent).toBe("生成第 7 章");
  });

  it("renders session.queue.length (not hardcoded 0)", () => {
    vi.mocked(useAutopilotSession).mockReturnValueOnce(
      buildHookReturn({
        ...DEFAULT_SESSION,
        queue: [
          { id: "q1", description: "a" },
          { id: "q2", description: "b" },
        ],
      }),
    );
    render(
      <ModeSwitchConfirmModal projectId="p" open={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId("confirm-queue").textContent).toContain("2");
  });

  it("'取消' calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ModeSwitchConfirmModal projectId="p" open={true} onCancel={onCancel} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'切换到手动模式' calls onConfirm with the wait-finish flag", () => {
    const onConfirm = vi.fn();
    render(
      <ModeSwitchConfirmModal projectId="p" open={true} onCancel={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("confirm-wait-finish"));
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ waitForCurrent: true });
    expect(onConfirm.mock.calls[0][0]).toEqual({ waitForCurrent: true });
  });

  it("kind='take-over' renders '立即接管' confirm button", () => {
    render(
      <ModeSwitchConfirmModal
        projectId="p"
        open={true}
        kind="take-over"
        chapterNumber={7}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-confirm").textContent).toContain("立即接管");
    expect(screen.getByText(/第 7 章/)).toBeInTheDocument();
  });

  it("take-over confirm forwards chapterNumber alongside waitForCurrent", () => {
    const onConfirm = vi.fn();
    render(
      <ModeSwitchConfirmModal
        projectId="p"
        open={true}
        kind="take-over"
        chapterNumber={7}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ waitForCurrent: true, chapterNumber: 7 });
  });
});