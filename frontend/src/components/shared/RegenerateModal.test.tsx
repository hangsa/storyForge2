import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegenerateModal } from "./RegenerateModal";

describe("RegenerateModal", () => {
  it("auto-focuses the textarea when opened", () => {
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it("calls onConfirm with the typed text", async () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见");
    await userEvent.type(textarea, "让节奏更紧凑");
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onConfirm).toHaveBeenCalledWith("让节奏更紧凑");
  });

  it("calls onConfirm with empty string when submitted blank", () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("calls onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Cmd+Enter is pressed in the textarea", () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见");
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("blocks input past 1000 characters", () => {
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(1000);
  });

  it("title contains the target string", () => {
    render(
      <RegenerateModal
        open
        target="第二章第一场"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/重新生成.*第二章第一场/)).toBeInTheDocument();
  });
});
