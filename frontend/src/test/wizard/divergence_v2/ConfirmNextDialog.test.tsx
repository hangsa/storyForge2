import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmNextDialog } from "@/components/wizard/divergence_v2/ConfirmNextDialog";

describe("ConfirmNextDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmNextDialog open={false} targetStage={null} affectedStages={[]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders affected stages when open", () => {
    render(
      <ConfirmNextDialog open={true} targetStage="2" affectedStages={["3", "4"]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // targetStage label appears twice (title + body paragraph) — use getAllByText
    expect(screen.getAllByText(/第一性拆解/).length).toBeGreaterThan(0);
    expect(screen.getByText(/自适应发散/)).toBeInTheDocument();
    expect(screen.getByText(/提交/)).toBeInTheDocument();
  });

  it("cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmNextDialog open={true} targetStage="2" affectedStages={["3"]} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId("confirm-next-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("confirm button calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmNextDialog open={true} targetStage="2" affectedStages={["3"]} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("confirm-next-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });
});
