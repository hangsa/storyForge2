import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManagedStartModal, { ManagedStartConfig } from "../components/workspace/ManagedStartModal";

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("../api/autopilot", async () => {
  const actual = await vi.importActual<typeof import("../api/autopilot")>("../api/autopilot");
  return {
    ...actual,
    rangePreview: vi.fn(),
    getAutopilotSession: vi.fn().mockResolvedValue({
      state: "stopped", config: null, queue: [], history: [], current_task: null,
    }),
    startAutopilotSession: vi.fn().mockResolvedValue({ state: "running" }),
  };
});

import { rangePreview, startAutopilotSession } from "../api/autopilot";

describe("ManagedStartModal — range scope", () => {
  beforeEach(() => {
    vi.mocked(rangePreview).mockReset();
    vi.mocked(startAutopilotSession).mockReset();
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    vi.mocked(startAutopilotSession).mockResolvedValue({ state: "running" } as any);
  });

  it("default scope is range with start/end inputs visible", async () => {
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeTruthy());
    const rangeRadio = screen.getByDisplayValue("range") as HTMLInputElement;
    expect(rangeRadio.checked).toBe(true);
    expect(screen.getByTestId("range-start")).toBeTruthy();
    expect(screen.getByTestId("range-end")).toBeTruthy();
  });

  it("selecting all_planned hides start/end inputs", async () => {
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    fireEvent.click(screen.getByDisplayValue("all_planned"));
    expect(screen.queryByTestId("range-start")).toBeNull();
    expect(screen.queryByTestId("range-end")).toBeNull();
  });

  it("shows regen warning when preview returns regenerate_chapters", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [5, 6, 7], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => {
      expect(screen.getByTestId("regen-warning")).toBeTruthy();
    });
    expect(screen.getByText(/第 5, 6, 7 章/)).toBeTruthy();
  });

  it("shows preview error message when valid=false", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: false, error: "结束章节超出最大章节数",
      regenerate_chapters: [], defaults: null,
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => {
      expect(screen.getByTestId("preview-error")).toBeTruthy();
    });
    expect(screen.getByText(/结束章节超出最大章节数/)).toBeTruthy();
  });

  it("opens confirmation dialog when Start clicked and regen chapters present", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [5, 6], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => screen.getByTestId("regen-warning"));
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    });
    expect(startAutopilotSession).not.toHaveBeenCalled();
  });

  it("skips confirmation and POSTs directly when no regen chapters", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    const onStarted = vi.fn();
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={onStarted} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => expect(rangePreview).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(startAutopilotSession).toHaveBeenCalled());
    expect(onStarted).toHaveBeenCalled();
  });

  it("all_planned with completed chapters also shows regen warning + confirmation", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [1, 2, 3], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    fireEvent.click(screen.getByDisplayValue("all_planned"));
    await waitFor(() => screen.getByTestId("regen-warning"));
    expect(screen.getByText(/第 1, 2, 3 章/)).toBeTruthy();
  });
});
