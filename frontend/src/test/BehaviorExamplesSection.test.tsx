import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BehaviorExamplesSection from "../components/wizard/BehaviorExamplesSection";
import type { BehaviorExample } from "../api/client";

const SAMPLE: BehaviorExample[] = [
  { situation: "挚友被陷害", action: "压制怒火", speech_sample: "我会让你付出代价。" },
  { situation: "师父失踪", action: "暗中调查", speech_sample: "真相终会大白。" },
];

describe("BehaviorExamplesSection", () => {
  it("renders each example with three editable textareas", () => {
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={() => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6); // 2 examples × 3 fields
    expect(screen.getByDisplayValue("挚友被陷害")).toBeInTheDocument();
    expect(screen.getByDisplayValue("我会让你付出代价。")).toBeInTheDocument();
  });

  it("emits onChange when a textarea value changes", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("挚友被陷害"), { target: { value: "新触发" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated[0].situation).toBe("新触发");
  });

  it("renders the '添加示例' button when list is empty", () => {
    render(<BehaviorExamplesSection examples={[]} onChange={() => {}} />);
    expect(screen.getByTestId("behavior-example-add")).toBeInTheDocument();
  });

  it("clicking '添加示例' appends a blank example and emits onChange", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("behavior-example-add"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual({ situation: "", action: "", speech_sample: "" });
  });

  it("clicking delete on an example removes it and emits onChange", () => {
    const onChange = vi.fn();
    render(<BehaviorExamplesSection examples={SAMPLE} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId("behavior-example-delete")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as BehaviorExample[];
    expect(updated).toHaveLength(1);
    expect(updated[0].situation).toBe("师父失踪");
  });

  it("renders the regenerate button and spinner when regenerating=true", () => {
    render(
      <BehaviorExamplesSection
        examples={SAMPLE}
        onChange={() => {}}
        onRegenerate={() => {}}
        regenerating={true}
      />,
    );
    expect(screen.getByTestId("behavior-example-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("behavior-example-regenerate-spinner")).toBeInTheDocument();
  });

  it("calls onRegenerate when the button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <BehaviorExamplesSection
        examples={SAMPLE}
        onChange={() => {}}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByTestId("behavior-example-regenerate"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});