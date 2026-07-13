import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/autopilot", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    getAutopilotSession: vi.fn().mockResolvedValue(null),
    startAutopilotSession: vi.fn().mockResolvedValue(undefined),
  };
});

import ManagedStartModal from "../components/workspace/ManagedStartModal";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ManagedStartModal", () => {
  it("renders only when open and session is loaded", async () => {
    const { rerender } = render(
      <ManagedStartModal projectId="p" open={false} onCancel={() => {}} onStarted={() => {}} />,
    );
    expect(screen.queryByTestId("managed-start-modal")).not.toBeInTheDocument();
    rerender(
      <ManagedStartModal projectId="p" open={true} onCancel={() => {}} onStarted={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
  });

  it("'稍后再说' calls onCancel", async () => {
    const onCancel = vi.fn();
    render(<ManagedStartModal projectId="p" open={true} onCancel={onCancel} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'启动托管' calls startAutopilotSession and onStarted", async () => {
    const onStarted = vi.fn();
    const { rerender } = render(
      <ManagedStartModal projectId="p" open={true} onCancel={() => {}} onStarted={onStarted} />,
    );
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const start = (await import("../api/autopilot")).startAutopilotSession as any;
    expect(start).toHaveBeenCalled();
    rerender(
      <ManagedStartModal projectId="p" open={false} onCancel={() => {}} onStarted={() => {}} />,
    );
  });
});