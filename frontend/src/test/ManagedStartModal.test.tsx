import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const showMock = vi.fn();

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ show: showMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("../api/autopilot", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    getAutopilotSession: vi.fn().mockResolvedValue(null),
    startAutopilotSession: vi.fn().mockResolvedValue(undefined),
  };
});

import ManagedStartModal from "../components/workspace/ManagedStartModal";

function renderModal(props: React.ComponentProps<typeof ManagedStartModal>) {
  return render(<ManagedStartModal {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ManagedStartModal", () => {
  beforeEach(() => {
    showMock.mockClear();
  });

  it("renders only when open and session is loaded", async () => {
    const { rerender } = renderModal({
      projectId: "p", open: false, onCancel: () => {}, onStarted: () => {},
    });
    expect(screen.queryByTestId("managed-start-modal")).not.toBeInTheDocument();
    rerender(<ManagedStartModal projectId="p" open={true} onCancel={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
  });

  it("'稍后再说' calls onCancel", async () => {
    const onCancel = vi.fn();
    renderModal({ projectId: "p", open: true, onCancel, onStarted: () => {} });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'启动托管' calls startAutopilotSession and onStarted", async () => {
    const onStarted = vi.fn();
    renderModal({ projectId: "p", open: true, onCancel: () => {}, onStarted });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const start = (await import("../api/autopilot")).startAutopilotSession as any;
    expect(start).toHaveBeenCalled();
  });

  it("submit failure surfaces a toast instead of calling onStarted", async () => {
    const { startAutopilotSession } = await import("../api/autopilot");
    vi.mocked(startAutopilotSession).mockRejectedValueOnce(new Error("409 state conflict"));
    const onStarted = vi.fn();
    renderModal({ projectId: "p", open: true, onCancel: () => {}, onStarted });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    expect(showMock.mock.calls[0][0]).toContain("409");
    expect(onStarted).not.toHaveBeenCalled();
  });
});
describe("ManagedStartModal no_work_to_do flow", () => {
  it("shows a friendly toast when backend reports no_work_to_do", async () => {
    const { startAutopilotSession } = await import("../api/autopilot");
    vi.mocked(startAutopilotSession).mockResolvedValueOnce({
      project_id: "p",
      state: "stopped",
      current_task: null,
      queue: [],
      history: [],
      config: null,
      no_work_to_do: true,
      outline_max: 30,
      current_chapter: 21,
      requested_scope: "all_planned",
      scope_used: "all_planned",
      fallback_applied: false,
      repaired_chapters: [],
      message: "项目已全部写完（共 30 章），无新任务可推进。",
    });
    const onStarted = vi.fn();
    renderModal({ projectId: "p", open: true, onCancel: () => {}, onStarted });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    expect(showMock.mock.calls[0][0]).toContain("30");
    expect(showMock.mock.calls[0][0]).toContain("全部写完");
    // The session was started (so state briefly went to running) and then
    // immediately stopped. Either way, the user gets the modal closed and
    // the toast carries the explanation — no more "click does nothing".
    expect(onStarted).toHaveBeenCalled();
  });

  it("surveys fallback message when scope was widened", async () => {
    const { startAutopilotSession } = await import("../api/autopilot");
    vi.mocked(startAutopilotSession).mockResolvedValueOnce({
      project_id: "p",
      state: "stopped",
      current_task: null,
      queue: [],
      history: [],
      config: null,
      no_work_to_do: true,
      outline_max: 33,
      current_chapter: 21,
      requested_scope: "all_planned",
      scope_used: "all_planned",
      fallback_applied: true,
      repaired_chapters: [],
      message:
        "已自动扩展推进范围，但大纲共 33 章内亦无新章节可推进。",
    });
    renderModal({ projectId: "p", open: true, onCancel: () => {}, onStarted: () => {} });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    const toastText = showMock.mock.calls[0][0] as string;
    // The fallback message must surface so the user understands why
    // "all done" happened even though their requested scope was narrow.
    expect(toastText).toContain("扩展");
    expect(toastText).toContain("33");
  });

  it("surveys repaired_chapters when server reported any", async () => {
    const { startAutopilotSession } = await import("../api/autopilot");
    vi.mocked(startAutopilotSession).mockResolvedValueOnce({
      project_id: "p",
      state: "stopped",
      current_task: null,
      queue: [],
      history: [],
      config: null,
      no_work_to_do: true,
      outline_max: 30,
      current_chapter: 21,
      requested_scope: "all_planned",
      scope_used: "all_planned",
      fallback_applied: false,
      repaired_chapters: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      message: "项目已全部写完（共 30 章），无新任务可推进。",
    });
    renderModal({ projectId: "p", open: true, onCancel: () => {}, onStarted: () => {} });
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    const toastText = showMock.mock.calls[0][0] as string;
    expect(toastText).toContain("已自动修复 10 个卡死章节");
    expect(toastText).toContain("21");
    expect(toastText).toContain("30");
  });
});
