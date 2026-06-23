import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NodeDetailPanel from "../../components/creative-canvas/NodeDetailPanel";
import type { CanvasNode } from "../../api/client";

const baseNode: CanvasNode = {
  id: "a", depth: 1, parent_id: "root", content: "Test content",
  novelty_score: 75, trope_tags: [], saturation_warning: null,
  children_ids: [], is_expanded: false, branch_status: "active",
};

describe("NodeDetailPanel", () => {
  it("does not render dimension card", () => {
    render(
      <NodeDetailPanel
        node={baseNode}
        noveltyScore={null}
        suggestion=""
        isPathEndpoint={false}
        isOnActivePath={true}
        onExpand={() => {}}
        onEvaluate={() => {}}
        onSelectPath={() => {}}
        onGetMutation={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("维度")).not.toBeInTheDocument();
  });

  it("renders choose-as-branch button when node is dimmed", () => {
    const dimmedNode = { ...baseNode, branch_status: "dimmed" as const };
    const onChoose = vi.fn();
    render(
      <NodeDetailPanel
        node={dimmedNode}
        noveltyScore={null}
        suggestion=""
        isPathEndpoint={false}
        isOnActivePath={false}
        onChooseAsBranch={onChoose}
        onExpand={() => {}}
        onEvaluate={() => {}}
        onSelectPath={() => {}}
        onGetMutation={() => {}}
        onClose={() => {}}
      />
    );
    const btn = screen.getByRole("button", { name: /选择为分支/ });
    fireEvent.click(btn);
    expect(onChoose).toHaveBeenCalledWith("a");
  });

  it("hides novelty score card when node is not on active path", () => {
    render(
      <NodeDetailPanel
        node={baseNode}
        noveltyScore={{
          total: 75, market_saturation_score: 70,
          trope_similarity_score: 80, contradiction_depth_score: 60,
          discussion_potential_score: 90, grade: "B",
        }}
        suggestion=""
        isPathEndpoint={false}
        isOnActivePath={false}
        onExpand={() => {}}
        onEvaluate={() => {}}
        onSelectPath={() => {}}
        onGetMutation={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("新颖度评分")).not.toBeInTheDocument();
  });
});