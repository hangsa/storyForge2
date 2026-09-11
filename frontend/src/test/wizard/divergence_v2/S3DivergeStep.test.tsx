import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S3DivergeStep from "@/components/wizard/divergence_v2/S3DivergeStep";
import { partitionOriginalCandidate } from "@/components/wizard/divergence_v2/S3DivergeStep";
import type { DimensionDecomposition, UnitCandidate } from "@/components/wizard/divergence_v2/types";

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
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />);
    expect(screen.getByText(/连锁 A/)).toBeInTheDocument();
    expect(screen.getByText(/连锁 B/)).toBeInTheDocument();
  });

  it("selecting a different candidate calls onSelectCandidate with the candidate's rank", () => {
    const onSelect = vi.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={onSelect} />);
    fireEvent.click(screen.getByTestId("candidate-c2"));
    expect(onSelect).toHaveBeenCalledWith("u1", 1);
  });

  it("failed unit shows '该单元暂不可用' + regen button", () => {
    const onRegen = vi.fn();
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={onRegen} onSelectCandidate={vi.fn()} />);
    expect(screen.getByText(/该单元暂不可用/)).toBeInTheDocument();
    const buttons = screen.getAllByText("重新生成该单元");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onRegen).toHaveBeenCalledWith("u2");
  });

  it("renders 'all failed' banner when every unit failed", () => {
    const allFailed: DimensionDecomposition[] = MOCK.map((d) => ({ ...d, candidates: [] }));
    render(<S3DivergeStep dimensions={allFailed} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />);
    expect(screen.getByTestId("all-failed-banner")).toBeInTheDocument();
  });

  it("does not render the Stage-3 title, stats line, or in-stage '全部重新生成' button (moved to footer 2026-09-08)", () => {
    // Regression guard: the "Stage 3 · 自适应发散" title was redundant with
    // the StepIndicator above, the "{n} 个候选 · {m} 个失败" stats line was
    // just an echo of data already shown per-section, and the in-stage
    // "全部重新生成" button moved to the page-level wizard footer as a
    // sibling of "下一步:提交 →". All three removals are 2026-09-08.
    render(<S3DivergeStep dimensions={MOCK} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />);
    expect(screen.queryByText(/Stage 3 · 自适应发散/)).toBeNull();
    expect(screen.queryByText(/个候选 · .*个失败/)).toBeNull();
    expect(screen.queryByRole("button", { name: /全部重新生成/ })).toBeNull();
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
      render(<S3DivergeStep dimensions={noSelection} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />),
    ).not.toThrow();
  });

  it("renders the __original virtual candidate as the first row with [原始拆解] prefix", () => {
    // Task 7: virtual candidate (id ends with __original, selection_rank=0)
    // should appear as the first row, prepended with the muted [原始拆解] label.
    const withOriginal: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        candidates: [
          { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "LLM 候选 A", chain_reaction: "连锁 A", main_operator: "distort", aux_operator: null, selection_rank: 0 },
          { id: "c2", unit_id: "u1", unit_name: "灵窍", description: "LLM 候选 B", chain_reaction: "连锁 B", main_operator: "break", aux_operator: "blend", selection_rank: 1 },
          { id: "u1__original", unit_id: "u1", unit_name: "灵窍", description: "原始拆解文本", chain_reaction: "原始连锁", main_operator: "distort", aux_operator: null, selection_rank: 0 },
        ],
        dimension_status: "diverged",
      },
    ];
    render(<S3DivergeStep dimensions={withOriginal} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />);
    // Virtual candidate renders the [原始拆解] prefix
    expect(screen.getByText("[原始拆解]")).toBeInTheDocument();
    // Virtual candidate is the first row inside the unit section
    const unitDiv = screen.getByTestId("diverge-unit-u1");
    const candidateRows = unitDiv.querySelectorAll("[data-testid^='candidate-']");
    expect(candidateRows[0].getAttribute("data-testid")).toBe("candidate-u1__original");
  });

  it("does not render '连锁推演:' line when chain_reaction is empty", () => {
    // Task 7: virtual candidate (and any candidate with empty chain_reaction)
    // should not show the empty "连锁推演:" suffix.
    const emptyChain: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        candidates: [
          { id: "u1__original", unit_id: "u1", unit_name: "灵窍", description: "原始拆解文本", chain_reaction: "", main_operator: "distort", aux_operator: null, selection_rank: 0 },
        ],
        dimension_status: "diverged",
      },
    ];
    render(<S3DivergeStep dimensions={emptyChain} loading={false} onRegenerateUnit={vi.fn()} onSelectCandidate={vi.fn()} />);
    const originalRow = screen.getByTestId("candidate-u1__original");
    expect(originalRow.textContent).not.toMatch(/连锁推演/);
  });

  // Task 8: legacy-state auto-/diverge. S3 should fire onRegenerateAll exactly
  // once on mount when a unit has candidates but none of them is the virtual
  // __original row (state.json predates the backend helper).
  describe("legacy state auto-/diverge", () => {
    const LEGACY: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        // No `__original` candidate: legacy state.json.
        candidates: [
          { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "旧候选 A", chain_reaction: "链 A", main_operator: "distort", aux_operator: null, selection_rank: 0 },
          { id: "c2", unit_id: "u1", unit_name: "灵窍", description: "旧候选 B", chain_reaction: "链 B", main_operator: "break", aux_operator: "blend", selection_rank: 1 },
        ],
        dimension_status: "diverged",
      },
    ];

    const FRESH: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        candidates: [
          { id: "u1__original", unit_id: "u1", unit_name: "灵窍", description: "原始", chain_reaction: "", main_operator: "distort", aux_operator: null, selection_rank: 0 },
          { id: "c1", unit_id: "u1", unit_name: "灵窍", description: "新候选 A", chain_reaction: "链 A", main_operator: "distort", aux_operator: null, selection_rank: 1 },
        ],
        dimension_status: "diverged",
      },
    ];

    const EMPTY: DimensionDecomposition[] = [
      {
        dimension: "ontology",
        insight: "",
        units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
        candidates: [],
        dimension_status: "pending",
      },
    ];

    it("fires onRegenerateAll once on mount when a unit's candidates lack __original", () => {
      const onRegenerateAll = vi.fn();
      render(
        <S3DivergeStep
          dimensions={LEGACY}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).toHaveBeenCalledTimes(1);
    });

    it("does not fire onRegenerateAll when every unit already has a __original candidate", () => {
      const onRegenerateAll = vi.fn();
      render(
        <S3DivergeStep
          dimensions={FRESH}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).not.toHaveBeenCalled();
    });

    it("does not fire onRegenerateAll when units have no candidates yet (not legacy, just pending)", () => {
      const onRegenerateAll = vi.fn();
      render(
        <S3DivergeStep
          dimensions={EMPTY}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).not.toHaveBeenCalled();
    });

    it("does not fire onRegenerateAll while loading=true (parent already has an in-flight /diverge)", () => {
      const onRegenerateAll = vi.fn();
      render(
        <S3DivergeStep
          dimensions={LEGACY}
          loading={true}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).not.toHaveBeenCalled();
    });

    it("does not crash when onRegenerateAll is omitted", () => {
      expect(() =>
        render(
          <S3DivergeStep
            dimensions={LEGACY}
            loading={false}
            onRegenerateUnit={vi.fn()}
            onSelectCandidate={vi.fn()}
          />,
        ),
      ).not.toThrow();
    });

    it("fires onRegenerateAll exactly once across re-renders with the same legacy shape", () => {
      const onRegenerateAll = vi.fn();
      const { rerender } = render(
        <S3DivergeStep
          dimensions={LEGACY}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      // Same legacy dimensions, re-render with loading=true (parent started
      // the diverge call we triggered) — should NOT pile on another call.
      rerender(
        <S3DivergeStep
          dimensions={LEGACY}
          loading={true}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      // Re-render after failure / unrelated state change — still just one.
      rerender(
        <S3DivergeStep
          dimensions={LEGACY}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).toHaveBeenCalledTimes(1);
    });

    it("detects legacy state in any unit even if other units are fresh (mixed shape)", () => {
      const mixed: DimensionDecomposition[] = [
        {
          dimension: "ontology",
          insight: "",
          units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", follow_up_count: 0, is_irreducible: false }],
          // Fresh: has __original.
          candidates: [
            { id: "u1__original", unit_id: "u1", unit_name: "灵窍", description: "原始", chain_reaction: "", main_operator: "distort", aux_operator: null, selection_rank: 0 },
          ],
          dimension_status: "diverged",
        },
        {
          dimension: "energetics",
          insight: "",
          units: [{ id: "u2", dimension: "energetics", unit_name: "修行", description: "d", follow_up_count: 0, is_irreducible: false }],
          // Legacy: no __original.
          candidates: [
            { id: "c1", unit_id: "u2", unit_name: "修行", description: "旧候选", chain_reaction: "", main_operator: "distort", aux_operator: null, selection_rank: 0 },
          ],
          dimension_status: "diverged",
        },
      ];
      const onRegenerateAll = vi.fn();
      render(
        <S3DivergeStep
          dimensions={mixed}
          loading={false}
          onRegenerateUnit={vi.fn()}
          onSelectCandidate={vi.fn()}
          onRegenerateAll={onRegenerateAll}
        />,
      );
      expect(onRegenerateAll).toHaveBeenCalledTimes(1);
    });
  });
});

const makeCand = (id: string, rank: number): UnitCandidate => ({
  id, unit_id: "u", unit_name: "u", description: id,
  chain_reaction: "", main_operator: "distort", aux_operator: null,
  selection_rank: rank,
});

describe("partitionOriginalCandidate", () => {
  it("extracts the __original candidate and preserves order of the rest", () => {
    const cands = [makeCand("c1", 1), makeCand("c2", 2), makeCand("u__original", 0), makeCand("c3", 3)];
    const { original, others } = partitionOriginalCandidate(cands);
    expect(original?.id).toBe("u__original");
    expect(others.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("returns null original when no virtual candidate present", () => {
    const cands = [makeCand("c1", 0), makeCand("c2", 1)];
    const { original, others } = partitionOriginalCandidate(cands);
    expect(original).toBeNull();
    expect(others).toEqual(cands);
  });

  it("handles empty array", () => {
    const { original, others } = partitionOriginalCandidate([]);
    expect(original).toBeNull();
    expect(others).toEqual([]);
  });
});
