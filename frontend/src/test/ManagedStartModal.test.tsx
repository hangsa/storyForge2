import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManagedStartModal from "../components/workspace/ManagedStartModal";

describe("ManagedStartModal", () => {
  it("renders only when open", () => {
    const { rerender } = render(
      <ManagedStartModal open={false} onCancel={() => {}} onStart={() => {}} />,
    );
    expect(screen.queryByTestId("managed-start-modal")).not.toBeInTheDocument();
    rerender(
      <ManagedStartModal open={true} onCancel={() => {}} onStart={() => {}} />,
    );
    expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument();
  });

  it("'稍后再说' calls onCancel", () => {
    const onCancel = vi.fn();
    render(<ManagedStartModal open={true} onCancel={onCancel} onStart={() => {}} />);
    fireEvent.click(screen.getByTestId("start-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'启动托管' calls onStart with selected config", () => {
    const onStart = vi.fn();
    render(<ManagedStartModal open={true} onCancel={() => {}} onStart={onStart} />);
    fireEvent.click(screen.getByTestId("start-submit"));
    expect(onStart).toHaveBeenCalledTimes(1);
    const cfg = onStart.mock.calls[0][0];
    expect(cfg).toEqual(
      expect.objectContaining({ scope: expect.any(String), cadence: expect.any(String) }),
    );
  });
});