import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S3DivergeStep from "@/components/wizard/divergence_v2/S3DivergeStep";
import type { DimensionDecomposition } from "@/components/wizard/divergence_v2/types";

const MOCK: DimensionDecomposition[] = [
  {
    dimension: "ontology",
    insight: "",
    units: [
      { id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false },
    ],
    candidates: [
      { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "候选 A 描述", chain_reaction: "连锁 A", main_operator: "distort", aux_operator: null, selection_rank: 0 },
      { id: "c2", unit_id: "u1", unit_name: "灵窍", description: "候选 B 描述", chain_reaction: "连锁 B", main_operator: "break", aux_operator: "blend", selection_rank: 1 },
    ],
    dimension_status: "diverged",
  },
  {
    dimension: "energetics",
    insight: "",
    units: [{ id: "u2", dimension: "energetics", unit_name: "修行", description: "d", follow_up_count: 0, is_irreducible: false }],
    candidates: [],
    dimension_status: "divergence_failed",
  },
];

describe("S3DivergeStep", () => {
  it("renders chain_reaction text for each candidate", () => {
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} onRegenerateAll={vi.fn()} />);
    expect(screen.getByText(/连锁 A/)).toBeInTheDocument();
    expect(screen.getByText(/连锁 B/)).toBeInTheDocument();
  });

  it("selecting a different candidate calls onSelectCandidate with the candidate's rank", () => {
    const onSelect = vi.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={onSelect} onRegenerateAll={vi.fn()} />);
    fireEvent.click(screen.getByTestId("candidate-c2"));
    expect(onSelect).toHaveBeenCalledWith("u1", 1);
  });

  it("failed unit shows '该单元暂不可用' + regen button", () => {
    const onRegen = vi.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={onRegen} onSelectCandidate={vi.fn()} onRegenerateAll={vi.fn()} />);
    expect(screen.getByText(/该单元暂不可用/)).toBeInTheDocument();
    const buttons = screen.getAllByText("重新生成该单元");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onRegen).toHaveBeenCalledWith("u2");
  });

  it("renders 'all failed' banner when every unit failed", () => {
    const allFailed: DimensionDecomposition[] = MOCK.map((d) => ({ ...d, candidates: [] }));
    render(<S3DivergeStep dimensions={allFailed} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} onRegenerateAll={vi.fn()} />);
    expect(screen.getByTestId("all-failed-banner")).toBeInTheDocument();
  });

  it("'全部重新生成' calls onRegenerateAll", () => {
    const onAll = vi.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} onRegenerateAll={onAll} />);
    fireEvent.click(screen.getByText("全部重新生成"));
    expect(onAll).toHaveBeenCalled();
  });

  it("renders safely when no candidate has selection_rank 0 (no crash)", () => {
    const noSelection: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        candidates: [
          { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "A", chain_reaction: "chain A", main_operator: "distort", aux_operator: null, selection_rank: 5 },
          { id: "c2", unit_id: "u1", unit_name: "灵窍", description: "B", chain_reaction: "chain B", main_operator: "break", aux_operator: "blend", selection_rank: 7 },
        ],
        dimension_status: "diverged",
      },
    ];
    expect(() =>
      render(<S3DivergeStep dimensions={noSelection} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} onRegenerateAll={vi.fn()} />),
    ).not.toThrow();
  });
});