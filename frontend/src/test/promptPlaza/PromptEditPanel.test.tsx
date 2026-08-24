import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptEditPanel from "../../components/home/promptPlaza/PromptEditPanel";
import type { PromptDetail } from "../../api/promptPlaza";

function makeDetail(extra: Record<string, unknown> = {}): PromptDetail {
  return {
    name: "scene_writing",
    builtin_yaml: {
      name: "scene_writing",
      system_prompt: "DEFAULT",
      user_prompt_template: "u",
      temperature: 0.7,
      max_tokens: 1000,
      output_format: {},
    },
    override: null,
    effective: {
      system_prompt: "DEFAULT",
      user_prompt_template: "u",
      temperature: 0.7,
      max_tokens: 1000,
      output_format: {},
      negative_constraints: "",
      ...extra,
    },
  };
}

const DETAIL: PromptDetail = {
  name: "scene_writing",
  builtin_yaml: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
  override: null,
  effective: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
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

  it("onSave payload does not include a model field", () => {
    const onSave = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "NEW sys" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty("model");
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

describe("PromptEditPanel negative_constraints", () => {
  it("renders negative_constraints textarea", () => {
    render(
      <PromptEditPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("edit-negative-constraints");
    expect(ta).toBeInTheDocument();
    expect(ta.tagName).toBe("TEXTAREA");
  });

  it("includes negative_constraints in save payload when dirty", () => {
    const onSave = vi.fn();
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: "OLD RULE" })}
        loading={false}
        error={null}
        onSave={onSave}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("edit-negative-constraints");
    fireEvent.change(ta, { target: { value: "新规则" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ negative_constraints: "新规则" }),
    );
  });

  it("clears negative_constraints on reset", () => {
    const onReset = vi.fn();
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: "BASELINE" })}
        loading={false}
        error={null}
        onSave={vi.fn()}
        onReset={onReset}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByTestId("edit-negative-constraints"),
      { target: { value: "DIRTY EDIT" } },
    );
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(onReset).toHaveBeenCalled();
  });

  it("shows soft-cap warning over 1500 chars", () => {
    const longText = "z".repeat(1501);
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: longText })}
        loading={false}
        error={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("nc-warn")).toBeInTheDocument();
    expect(screen.getByTestId("nc-warn").textContent).toMatch(/tokens/);
  });

  it("does not show soft-cap warning at exactly 1500 chars", () => {
    const atLimit = "z".repeat(1500);
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: atLimit })}
        loading={false}
        error={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("nc-warn")).toBeNull();
  });
});
