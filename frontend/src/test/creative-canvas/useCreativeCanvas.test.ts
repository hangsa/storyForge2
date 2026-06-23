import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useCreativeCanvas from "../../hooks/useCreativeCanvas";

vi.mock("../../api/client", () => ({
  default: {
    getCanvasState: vi.fn(),
    initCanvas: vi.fn(),
    expandNode: vi.fn(),
    evaluateNode: vi.fn(),
    selectPath: vi.fn(),
    resetCanvas: vi.fn(),
    getMutationSuggestion: vi.fn(),
    getConcept: vi.fn(),
    chooseBranch: vi.fn(),
  },
}));

import api from "../../api/client";

describe("useCreativeCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in empty state", () => {
    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    expect(result.current.status).toBe("empty");
    expect(Object.keys(result.current.nodes)).toHaveLength(0);
    expect(result.current.positions).toEqual({});
    expect(result.current.failedNodes).toEqual({});
  });

  it("records a failed expand as retryable", async () => {
    vi.mocked(api.expandNode).mockRejectedValueOnce(new Error("LLM timeout"));
    vi.mocked(api.getCanvasState).mockResolvedValueOnce({
      root_node_id: "wi_001_00",
      nodes: {
        "wi_001_00": {
          id: "wi_001_00",
          depth: 0,
          parent_id: null,
          content: "x",
          novelty_score: 0,
          trope_tags: [],
          saturation_warning: null,
          children_ids: [],
          is_expanded: false,
          branch_status: "active",
        },
      },
      edges: [],
      selected_path: [],
    });

    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    await act(async () => { await result.current.loadCanvas(); });

    await act(async () => { await result.current.expandNode("wi_001_00"); });

    expect(result.current.failedNodes["wi_001_00"]).toBeDefined();
    expect(result.current.failedNodes["wi_001_00"].message).toBe("LLM timeout");
    expect(result.current.status).toBe("initialized");
  });

  it("records node position via updatePosition", () => {
    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    act(() => result.current.updatePosition("wi_001_00", 100, 200));
    expect(result.current.positions["wi_001_00"]).toEqual({ x: 100, y: 200 });
  });

  it("resetCanvas clears state and calls API", async () => {
    vi.mocked(api.resetCanvas).mockResolvedValueOnce({ root_node_id: null, nodes: {}, edges: [], selected_path: [] });

    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    await act(async () => { await result.current.resetCanvas(); });

    expect(api.resetCanvas).toHaveBeenCalledWith("proj_test");
    expect(result.current.status).toBe("empty");
  });

  it("getMutationSuggestion updates mutationSuggestion state", async () => {
    vi.mocked(api.getMutationSuggestion).mockResolvedValueOnce({ recommendation: "试试反转" });

    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    await act(async () => { await result.current.getMutationSuggestion("wi_001_00"); });

    expect(result.current.mutationSuggestion).toEqual({
      nodeId: "wi_001_00",
      recommendation: "试试反转",
      loading: false,
    });
  });

  it("chooseBranch calls API and updates selectedPath + branchChoices", async () => {
    vi.mocked(api.chooseBranch).mockResolvedValueOnce({
      selected_path: ["a", "c"],
      branch_choices: { a: "c" },
      chosen_node: {} as any,
      dimmed_count: 2,
    });
    vi.mocked(api.getCanvasState).mockResolvedValueOnce({
      schema_version: 2,
      root_node_id: "a",
      nodes: {
        a: { id: "a", depth: 0, parent_id: null, content: "x", novelty_score: 0, trope_tags: [], saturation_warning: null, children_ids: [], is_expanded: false, branch_status: "active" },
        c: { id: "c", depth: 1, parent_id: "a", content: "y", novelty_score: 0, trope_tags: [], saturation_warning: null, children_ids: [], is_expanded: false, branch_status: "active" },
      },
      edges: [],
      selected_path: ["a", "c"],
      branch_choices: { a: "c" },
    });

    const { result } = renderHook(() => useCreativeCanvas("proj_test"));
    await act(async () => { await result.current.chooseBranch("a", "c"); });

    expect(api.chooseBranch).toHaveBeenCalledWith("proj_test", "a", "c");
    expect(result.current.selectedPath).toEqual(["a", "c"]);
    expect(result.current.branchChoices).toEqual({ a: "c" });
  });
});