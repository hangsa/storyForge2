import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0DWhatIfStep from "@/components/wizard/divergence/S0DWhatIfStep";
import api from "@/api/client";
import type { WhatIfNode } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeWhatIfExpand: vi.fn(),
    putDivergeWhatIfSelect: vi.fn(),
    postDivergeRegenerateWhatif: vi.fn(),
    postDivergeChooseBranch: vi.fn(),
    getDivergeState: vi.fn(),
  },
}));

const rootNode: WhatIfNode = {
  id: "root",
  content: "Root node",
  parent_id: null,
  novelty_score: null,
  children_ids: ["c1"],
};

const children: WhatIfNode[] = [
  {
    id: "c1",
    content: "Child 1",
    parent_id: "root",
    novelty_score: 0.7,
    children_ids: [],
  },
];

const grandchildren: WhatIfNode[] = [
  {
    id: "gc1",
    content: "Grandchild 1",
    parent_id: "c1",
    novelty_score: 0.85,
    children_ids: [],
  },
];

// Helper to build a canvas-state response with explicit active + dimmed
// children. The mount effect calls getDivergeState; this is what S0D sees
// on first render in a session where the user has previously expanded
// the root.
function canvasStateWithDimmedSiblings(opts: {
  activeChild: WhatIfNode;
  dimmedSiblings: WhatIfNode[];
  selectedPath: string[];
}) {
  const nodes: Record<string, WhatIfNode> = {
    root: { ...rootNode, children_ids: [opts.activeChild.id, ...opts.dimmedSiblings.map((d) => d.id)] },
    [opts.activeChild.id]: opts.activeChild,
    ...Object.fromEntries(opts.dimmedSiblings.map((d) => [d.id, d])),
  };
  return {
    root_node_id: "root",
    nodes,
    edges: [],
    selected_path: opts.selectedPath,
    branch_choices: { root: opts.activeChild.id },
    core_contradiction: null,
    novelty_scores: null,
    idea_variants: [],
  };
}

describe("S0DWhatIfStep", () => {
  beforeEach(() => {
    (api.postDivergeWhatIfExpand as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.putDivergeWhatIfSelect as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeChooseBranch as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    const nodesDict = Object.fromEntries(children.map((c) => [c.id, c]));
    const grandchildrenDict = Object.fromEntries(
      grandchildren.map((c) => [c.id, c]),
    );
    (api.postDivergeWhatIfExpand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ nodes: nodesDict, scores: {}, suggestion: "" })
      .mockResolvedValueOnce({
        nodes: grandchildrenDict,
        scores: {},
        suggestion: "",
      });
    (api.putDivergeWhatIfSelect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      selected_path: ["root", "c1"],
      evaluation: "ok",
      evaluated_at: "2026-08-31T00:00:00Z",
    });
    // Default canvas state: empty (no previously-expanded nodes).
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      root_node_id: "root",
      nodes: { root: rootNode },
      edges: [],
      selected_path: ["root"],
      branch_choices: {},
      core_contradiction: null,
      novelty_scores: null,
      idea_variants: [],
    });
    // /choose-branch default response: pretend the user just promoted a
    // sibling — selected_path now reflects the new active child.
    (api.postDivergeChooseBranch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      selected_path: ["root"],
      branch_choices: {},
      chosen_node: children[0],
      dimmed_count: 1,
    });
    (api.postDivergeRegenerateWhatif as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeRegenerateWhatif as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: {
        root: rootNode,
        nc1: {
          id: "nc1",
          content: "New Child 1",
          parent_id: "root",
          novelty_score: 0.9,
          children_ids: [],
        },
        nc2: {
          id: "nc2",
          content: "New Child 2",
          parent_id: "root",
          novelty_score: 0.6,
          children_ids: [],
        },
      },
      user_modifications_received: true,
    });
  });

  it("expands root node and shows its children", async () => {
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => {
      expect(screen.getByText("Child 1")).toBeInTheDocument();
    });
    expect(api.postDivergeWhatIfExpand).toHaveBeenCalledWith("p1", "root");
  });

  it("selects a node and submits the path root -> selected", async () => {
    const onComplete = vi.fn();
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => screen.getByText("Child 1"));
    fireEvent.click(screen.getByTestId("select-c1"));
    fireEvent.click(screen.getByTestId("s0d-submit"));
    await waitFor(() => {
      expect(api.putDivergeWhatIfSelect).toHaveBeenCalledWith("p1", ["root", "c1"]);
      expect(onComplete).toHaveBeenCalledWith(["root", "c1"]);
    });
  });

  it("disables submit when no node selected", async () => {
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => screen.getByText("Child 1"));
    const submitBtn = screen.getByTestId("s0d-submit");
    expect(submitBtn).toBeDisabled();
    expect(api.putDivergeWhatIfSelect).not.toHaveBeenCalled();
  });

  it("fires onBack when back button clicked", async () => {
    const onBack = vi.fn();
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByTestId("s0d-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("expands a child node and computes path through tree", async () => {
    const onComplete = vi.fn();
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => screen.getByText("Child 1"));
    fireEvent.click(screen.getByTestId("expand-c1"));
    await waitFor(() => screen.getByText("Grandchild 1"));
    fireEvent.click(screen.getByTestId("select-gc1"));
    fireEvent.click(screen.getByTestId("s0d-submit"));
    await waitFor(() => {
      expect(api.putDivergeWhatIfSelect).toHaveBeenCalledWith(
        "p1",
        ["root", "c1", "gc1"],
      );
      expect(onComplete).toHaveBeenCalledWith(["root", "c1", "gc1"]);
    });
  });

  it("regen button calls regen API + rebuilds tree from response nodes", async () => {
    const onCanvasMutated = vi.fn();
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    // Load initial tree so we know the baseline.
    fireEvent.click(screen.getByTestId("expand-root"));
    await waitFor(() => screen.getByText("Child 1"));

    fireEvent.click(screen.getByTestId("s0d-regenerate"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(api.postDivergeRegenerateWhatif).toHaveBeenCalledWith(
        "p1",
        { user_modifications: "" },
      );
      expect(onCanvasMutated).toHaveBeenCalled();
    });
    // Old children gone, new children present.
    await waitFor(() => {
      expect(screen.getByText("New Child 1")).toBeInTheDocument();
      expect(screen.getByText("New Child 2")).toBeInTheDocument();
      expect(screen.queryByText("Child 1")).not.toBeInTheDocument();
    });
  });

  it("renders dimmed siblings with 弃选 badge + 切换到此分支 button on mount when canvas has them", async () => {
    // Session reload: user previously expanded root → got c1 (active) and
    // c2 (dimmed) — typical scenario after a /choose-branch swap. On
    // mount, S0D should show both: c1 as the active tree child, c2 as a
    // dimmed sibling with the affordances.
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      canvasStateWithDimmedSiblings({
        activeChild: {
          id: "c1",
          content: "Active path",
          parent_id: "root",
          novelty_score: 0.7,
          children_ids: [],
        },
        dimmedSiblings: [
          {
            id: "c2",
            content: "Alt path A",
            parent_id: "root",
            novelty_score: 0.5,
            children_ids: [],
          },
          {
            id: "c3",
            content: "Alt path B",
            parent_id: "root",
            novelty_score: 0.6,
            children_ids: [],
          },
        ],
        selectedPath: ["root", "c1"],
      }),
    );

    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Active path")).toBeInTheDocument();
      expect(screen.getByTestId("dimmed-c2")).toBeInTheDocument();
      expect(screen.getByTestId("dimmed-c3")).toBeInTheDocument();
      expect(screen.getByTestId("badge-dimmed-c2")).toBeInTheDocument();
      expect(screen.getByTestId("switch-c2")).toBeInTheDocument();
      expect(screen.getByTestId("switch-c3")).toBeInTheDocument();
    });
  });

  it("does NOT render active child as a dimmed sibling of itself", async () => {
    // Regression guard: if the dimmed lookup forgets to exclude the active
    // child, every node would double-render (once as active, once as
    // dimmed). After canvas load, c1 is both on selected_path AND in the
    // tree's children — must appear only once.
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      canvasStateWithDimmedSiblings({
        activeChild: {
          id: "c1",
          content: "Active path",
          parent_id: "root",
          novelty_score: 0.7,
          children_ids: [],
        },
        dimmedSiblings: [],
        selectedPath: ["root", "c1"],
      }),
    );

    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("Active path"));
    expect(screen.queryByTestId("dimmed-c1")).not.toBeInTheDocument();
  });

  it("clicking 切换到此分支 calls postDivergeChooseBranch and rebuilds tree from new active", async () => {
    // User clicks 切换 on c2 (a previously-dimmed sibling of root's active
    // child c1). Backend should be called with the right parent/child IDs;
    // after the call, S0D re-reads /state and rebuilds the active tree
    // around c2. We simulate that by changing what /state returns on the
    // 2nd call.
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        canvasStateWithDimmedSiblings({
          activeChild: {
            id: "c1",
            content: "Active path",
            parent_id: "root",
            novelty_score: 0.7,
            children_ids: [],
          },
          dimmedSiblings: [
            {
              id: "c2",
              content: "Alt path A",
              parent_id: "root",
              novelty_score: 0.5,
              children_ids: [],
            },
          ],
          selectedPath: ["root", "c1"],
        }),
      )
      // After /choose-branch: c2 becomes the active child, c1 becomes the
      // dimmed sibling.
      .mockResolvedValueOnce(
        canvasStateWithDimmedSiblings({
          activeChild: {
            id: "c2",
            content: "Alt path A",
            parent_id: "root",
            novelty_score: 0.5,
            children_ids: [],
          },
          dimmedSiblings: [
            {
              id: "c1",
              content: "Active path",
              parent_id: "root",
              novelty_score: 0.7,
              children_ids: [],
            },
          ],
          selectedPath: ["root", "c2"],
        }),
      );

    const onCanvasMutated = vi.fn();
    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );

    await waitFor(() => screen.getByTestId("dimmed-c2"));
    fireEvent.click(screen.getByTestId("switch-c2"));

    await waitFor(() => {
      expect(api.postDivergeChooseBranch).toHaveBeenCalledWith("p1", "root", "c2");
      expect(onCanvasMutated).toHaveBeenCalled();
    });
    // After the swap, the new active path label must appear in the active
    // tree (not just under the dimmed bucket).
    await waitFor(() => {
      expect(screen.queryByTestId("dimmed-c2")).not.toBeInTheDocument();
      // c1 now becomes the dimmed sibling under root.
      expect(screen.getByTestId("dimmed-c1")).toBeInTheDocument();
    });
  });

  it("regen drops dimmed siblings from allNodes so old 弃选 badges don't linger", async () => {
    // After /regenerate/whatif, all non-root nodes are wiped and re-rolled.
    // The old dimmed siblings must not be carried into the new canvas view.
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeState as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      canvasStateWithDimmedSiblings({
        activeChild: {
          id: "c1",
          content: "Old active",
          parent_id: "root",
          novelty_score: 0.7,
          children_ids: [],
        },
        dimmedSiblings: [
          {
            id: "c2",
            content: "Old dimmed",
            parent_id: "root",
            novelty_score: 0.5,
            children_ids: [],
          },
        ],
        selectedPath: ["root", "c1"],
      }),
    );

    render(
      <S0DWhatIfStep
        projectId="p1"
        rootNode={rootNode}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId("dimmed-c2"));
    fireEvent.click(screen.getByTestId("s0d-regenerate"));
    await waitFor(() => screen.getByTestId("regenerate-modal"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(api.postDivergeRegenerateWhatif).toHaveBeenCalled();
    });
    // Old "Old dimmed" badge must NOT survive the regen rebuild.
    await waitFor(() => {
      expect(screen.queryByTestId("dimmed-c2")).not.toBeInTheDocument();
      expect(screen.queryByText("Old dimmed")).not.toBeInTheDocument();
    });
  });
});