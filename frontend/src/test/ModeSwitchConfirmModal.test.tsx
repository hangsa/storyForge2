import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModeSwitchConfirmModal from "../components/workspace/ModeSwitchConfirmModal";

describe("ModeSwitchConfirmModal", () => {
  it("renders when open and not in DOM when closed", () => {
    const { rerender } = render(
      <ModeSwitchConfirmModal open={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.queryByTestId("mode-switch-confirm")).not.toBeInTheDocument();
    rerender(
      <ModeSwitchConfirmModal open={true} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
  });

  it("renders mock AI state and queue summary", () => {
    render(
      <ModeSwitchConfirmModal
        open={true}
        currentTask="生成第 7 章"
        queueLength={4}
        plannedChapters={12}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-current-task")).toHaveTextContent("生成第 7 章");
    expect(screen.getByTestId("confirm-queue").textContent).toContain("4");
    expect(screen.getByTestId("confirm-planned").textContent).toContain("12");
  });

  it("'取消' calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ModeSwitchConfirmModal open={true} onCancel={onCancel} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("'切换到手动模式' calls onConfirm with the wait-finish flag", () => {
    const onConfirm = vi.fn();
    render(
      <ModeSwitchConfirmModal open={true} onCancel={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("confirm-wait-finish"));
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ waitForCurrent: true });
    expect(onConfirm.mock.calls[0][0]).toEqual({ waitForCurrent: true });
  });

  it("kind='take-over' renders '立即接管' confirm button", () => {
    render(
      <ModeSwitchConfirmModal
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