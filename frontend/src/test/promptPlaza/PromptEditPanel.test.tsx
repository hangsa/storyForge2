import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptEditPanel from "../../components/home/promptPlaza/PromptEditPanel";
import type { PromptDetail } from "../../api/promptPlaza";

const DETAIL: PromptDetail = {
  name: "scene_writing",
  builtin_yaml: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    model: "deepseek-chat",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
  override: null,
  effective: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    model: "deepseek-chat",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
};

describe("PromptEditPanel", () => {
  it("renders empty state when detail is null", () => {
    render(<PromptEditPanel detail={null} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/请从左侧选择一个提示词/)).toBeInTheDocument();
  });

  it("renders the prompt name and labels", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("scene_writing")).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/)).toBeInTheDocument();
    expect(screen.getByText(/User Prompt Template/)).toBeInTheDocument();
  });

  it("pre-fills textareas from effective values", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    const ta = screen.getByTestId("edit-system") as HTMLTextAreaElement;
    expect(ta.value).toBe("default sys");
    const userTa = screen.getByTestId("edit-user-template") as HTMLTextAreaElement;
    expect(userTa.value).toBe("default user {var}");
  });

  it("emits onSave with the edited fields", () => {
    const onSave = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "NEW sys" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      system_prompt: "NEW sys",
    }));
  });

  it("disables save when not dirty", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    const save = screen.getByTestId("save-button") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("enables save when system_prompt is changed", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "changed" } });
    const save = screen.getByTestId("save-button") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("calls onReset when reset button is clicked", () => {
    const onReset = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={onReset} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(onReset).toHaveBeenCalled();
  });

  it("does not render a model input in the Advanced section", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    // Open the Advanced section so its body is in the DOM
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    expect(screen.queryByTestId("adv-model")).toBeNull();
  });

  it("shows loading state", () => {
    render(<PromptEditPanel detail={null} loading={true} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<PromptEditPanel detail={null} loading={false} error="some error" onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("some error")).toBeInTheDocument();
  });
});
