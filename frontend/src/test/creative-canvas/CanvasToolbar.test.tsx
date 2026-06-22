import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CanvasToolbar from "../../components/creative-canvas/CanvasToolbar";

describe("CanvasToolbar", () => {
  it("renders node count and dimension legend", () => {
    render(
      <CanvasToolbar
        nodeCount={5}
        onRequestReset={() => {}}
        onFitView={() => {}}
      />
    );
    expect(screen.getByText(/节点: 5/)).toBeInTheDocument();
    expect(screen.getByText("角色动机")).toBeInTheDocument();
    expect(screen.getByText("情节方向")).toBeInTheDocument();
  });

  it("calls onRequestReset when reset button is clicked", () => {
    const onRequestReset = vi.fn();
    render(
      <CanvasToolbar
        nodeCount={5}
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
        onRequestReset={() => {}}
        onFitView={onFitView}
      />
    );
    fireEvent.click(screen.getByTitle("适应视图"));
    expect(onFitView).toHaveBeenCalledTimes(1);
  });
});
