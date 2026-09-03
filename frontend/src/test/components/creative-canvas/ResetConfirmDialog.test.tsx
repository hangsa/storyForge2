import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetConfirmDialog } from "@/components/creative-canvas/ResetConfirmDialog";

describe("ResetConfirmDialog", () => {
  it("renders PRD §18.2 copy", () => {
    render(<ResetConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/重新开始创意/)).toBeInTheDocument();
    expect(screen.getByText(/保留你的原始 Idea/)).toBeInTheDocument();
  });

  it("uses glass-panel styling (data-testid backdrop)", () => {
    const { container } = render(
      <ResetConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.querySelector(".glass-panel")).toBeInTheDocument();
  });

  it("calls onCancel when 取消 clicked", () => {
    const onCancel = vi.fn();
    render(<ResetConfirmDialog open onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when 重新开始 clicked", () => {
    const onConfirm = vi.fn();
    render(<ResetConfirmDialog open onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /重新开始/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <ResetConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
