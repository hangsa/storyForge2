import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0DWhatIfStep from "@/components/wizard/divergence/S0DWhatIfStep";
import api from "@/api/client";
import type { WhatIfNode } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeWhatIfExpand: vi.fn(),
    putDivergeWhatIfSelect: vi.fn(),
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

describe("S0DWhatIfStep", () => {
  beforeEach(() => {
    (api.postDivergeWhatIfExpand as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.putDivergeWhatIfSelect as unknown as ReturnType<typeof vi.fn>).mockReset();
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
});