import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManagedStartConfirmDialog from "../components/workspace/ManagedStartConfirmDialog";

describe("ManagedStartConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ManagedStartConfirmDialog
        open={false}
        chapterNumbers={[5, 6]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the chapter list when open", () => {
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5, 6, 7]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    expect(screen.getByText(/第 5, 6, 7 章/)).toBeTruthy();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-no"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders singular vs plural chapter text correctly", () => {
    const { rerender } = render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/第 5 章/)).toBeTruthy();
    rerender(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5, 6]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/第 5, 6 章/)).toBeTruthy();
  });
});
