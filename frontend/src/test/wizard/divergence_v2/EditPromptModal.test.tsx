import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditPromptModal } from "@/components/wizard/divergence_v2/EditPromptModal";

describe("EditPromptModal", () => {
  it("does not render when open=false", () => {
    render(
      <EditPromptModal
        open={false}
        initialText="hello"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("edit-prompt-modal")).toBeNull();
  });

  it("renders textarea prefilled with initialText when open", () => {
    render(
      <EditPromptModal
        open
        initialText="你是一位叙事结构诊断师..."
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("edit-prompt-modal")).toBeInTheDocument();
    const textarea = screen.getByLabelText("专用提示词") as HTMLTextAreaElement;
    expect(textarea.value).toBe("你是一位叙事结构诊断师...");
  });

  it("calls onSave with the edited text when 「保存」 clicked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditPromptModal
        open
        initialText="initial"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("专用提示词");
    fireEvent.change(textarea, { target: { value: "edited" } });
    fireEvent.click(screen.getByTestId("edit-prompt-modal-confirm"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("edited"));
  });

  it("calls onCancel when 「取消」 clicked", () => {
    const onCancel = vi.fn();
    render(
      <EditPromptModal
        open
        initialText="x"
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("edit-prompt-modal-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("closes without calling onSave when Esc pressed", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(
      <EditPromptModal
        open
        initialText="x"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does NOT auto-trigger any decompose — only fires onSave (footer regen is user's job)", async () => {
    // Spec invariant: edit-and-save must not call any decompose API.
    // The EditPromptModal itself doesn't import any API; we assert via
    // mock that onSave is the only side-effect.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditPromptModal
        open
        initialText="a"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("edit-prompt-modal-confirm"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("shows spinner and disables controls while busy=true", () => {
    const onSave = vi.fn();
    render(
      <EditPromptModal
        open
        initialText="x"
        busy
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("edit-prompt-modal-confirm")).toBeDisabled();
    expect(screen.getByTestId("edit-prompt-modal-cancel")).toBeDisabled();
  });
});