import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import WhatIfTree from "../../components/creative-canvas/WhatIfTree";
import type { CanvasNode } from "../../api/client";

const nodeActive: CanvasNode = {
  id: "a", depth: 0, parent_id: null, content: "Root",
  novelty_score: 0, trope_tags: [], saturation_warning: null,
  children_ids: [], is_expanded: false, branch_status: "active",
};
const nodeDimmed: CanvasNode = {
  ...nodeActive, id: "b", depth: 1, parent_id: "a", branch_status: "dimmed",
};

describe("WhatIfTree", () => {
  it("renders dimmed node with opacity-50 class", () => {
    render(
      <ReactFlowProvider>
        <WhatIfTree
          nodes={{ a: nodeActive, b: nodeDimmed }}
          edges={[]}
          selectedNodeId={null}
          selectedPath={["a"]}
          positions={{}}
          failedNodes={{}}
          loadingNodes={{}}
          showDimmedChildren
          onNodeClick={() => {}}
          onNodeExpand={() => {}}
          onPositionChange={() => {}}
          onRetry={() => {}}
          onFitViewReady={() => {}}
        />
      </ReactFlowProvider>
    );
    const dimmed = screen.getByTestId("node-b");
    expect(dimmed.className).toContain("opacity-50");
  });

  it("does not call onNodeExpand when dimmed node is double-clicked", () => {
    const onExpand = vi.fn();
    render(
      <ReactFlowProvider>
        <WhatIfTree
          nodes={{ a: nodeActive, b: nodeDimmed }}
          edges={[]}
          selectedNodeId={null}
          selectedPath={["a"]}
          positions={{}}
          failedNodes={{}}
          loadingNodes={{}}
          showDimmedChildren
          onNodeClick={() => {}}
          onNodeExpand={onExpand}
          onPositionChange={() => {}}
          onRetry={() => {}}
          onFitViewReady={() => {}}
        />
      </ReactFlowProvider>
    );
    const dimmed = screen.getByTestId("node-b");
    fireEvent.doubleClick(dimmed);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("calls onNodeExpand when active node is double-clicked", () => {
    const onExpand = vi.fn();
    render(
      <ReactFlowProvider>
        <WhatIfTree
          nodes={{ a: nodeActive }}
          edges={[]}
          selectedNodeId={null}
          selectedPath={["a"]}
          positions={{}}
          failedNodes={{}}
          loadingNodes={{}}
          onNodeClick={() => {}}
          onNodeExpand={onExpand}
          onPositionChange={() => {}}
          onRetry={() => {}}
          onFitViewReady={() => {}}
        />
      </ReactFlowProvider>
    );
    const active = screen.getByTestId("node-a");
    fireEvent.doubleClick(active);
    expect(onExpand).toHaveBeenCalledWith("a");
  });
});