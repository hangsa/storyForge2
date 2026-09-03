import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreCommitSummary } from "@/components/creative-canvas/PreCommitSummary";

describe("PreCommitSummary", () => {
  const stats = { depth: 4, novelty: 87, conflict: 91 };

  it("renders stats + 2 buttons per PRD §18.3", () => {
    render(<PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/创意深度：4 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/新颖度：87/)).toBeInTheDocument();
    expect(screen.getByText(/核心冲突：91/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /返回继续探索/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /形成概念/ })).toBeInTheDocument();
  });

  it("uses glass-panel styling", () => {
    const { container } = render(
      <PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.querySelector(".glass-panel")).toBeInTheDocument();
  });

  it("calls onCancel when 返回继续探索 clicked", () => {
    const onCancel = vi.fn();
    render(<PreCommitSummary open stats={stats} onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /返回继续探索/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCommit when 形成概念 → clicked", () => {
    const onCommit = vi.fn();
    render(<PreCommitSummary open stats={stats} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /形成概念/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <PreCommitSummary open={false} stats={stats} onCommit={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});