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