import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CanvasToolbar from "../../components/creative-canvas/CanvasToolbar";

describe("CanvasToolbar", () => {
  it("renders node count and active count", () => {
    render(
      <CanvasToolbar
        nodeCount={5}
        activeCount={3}
        showDimmedChildren={false}
        onToggleDimmedChildren={() => {}}
        onRequestReset={() => {}}
        onFitView={() => {}}
      />
    );
    expect(screen.getByText(/节点 5 \/ 激活 3/)).toBeInTheDocument();
  });

  it("calls onToggleDimmedChildren when toggle button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <CanvasToolbar
        nodeCount={5}
        activeCount={3}
        showDimmedChildren={false}
        onToggleDimmedChildren={onToggle}
        onRequestReset={() => {}}
        onFitView={() => {}}
      />
    );
    fireEvent.click(screen.getByText("显示未选子树"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onRequestReset when reset button is clicked", () => {
    const onRequestReset = vi.fn();
    render(
      <CanvasToolbar
        nodeCount={5}
        activeCount={3}
        showDimmedChildren={false}
        onToggleDimmedChildren={() => {}}
        onRequestReset={onRequestReset}
        onFitView={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle("重置画布"));
    expect(onRequestReset).toHaveBeenCalledTimes(1);
  });

  it("calls onFitView when fit-view button is clicked", () => {
    const onFitView = vi.fn();
    render(
      <CanvasToolbar
        nodeCount={5}
        activeCount={3}
        showDimmedChildren={false}
        onToggleDimmedChildren={() => {}}
        onRequestReset={() => {}}
        onFitView={onFitView}
      />
    );
    fireEvent.click(screen.getByTitle("适应视图"));
    expect(onFitView).toHaveBeenCalledTimes(1);
  });
});