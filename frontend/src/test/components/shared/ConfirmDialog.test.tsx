import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "../../../components/shared/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and message when open", () => {
    render(
      <ConfirmDialog
        open
        title="重新生成场景？"
        message="当前编辑的内容将被覆盖。是否继续？"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("重新生成场景？")).toBeInTheDocument();
    expect(screen.getByText(/当前编辑的内容将被覆盖/)).toBeInTheDocument();
  });

  it("clicking confirm button calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="t"
        message="m"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pressing Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables confirm button when busy is true", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        busy
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const confirmBtn = screen.getByTestId("confirm-dialog-confirm");
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders spinner icon when busy is true", () => {
    render(
      <ConfirmDialog
        open
        title="t"
        message="m"
        busy
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-spinner")).toBeInTheDocument();
  });
});