import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S2DecomposeStep from "@/components/wizard/divergence_v2/S2DecomposeStep";
import type { DimensionDecomposition } from "@/components/wizard/divergence_v2/types";

const MOCK_DIMENSIONS: DimensionDecomposition[] = [
  {
    dimension: "ontology",
    insight: "本土天道 vs 异域天道的殖民",
    units: [
      { id: "u1", dimension: "ontology", unit_name: "灵窍", description: "灵窍是接口...", follow_up_count: 0, is_irreducible: false },
      { id: "u2", dimension: "ontology", unit_name: "本源", description: "本源是...", follow_up_count: 1, is_irreducible: true },
    ],
    candidates: [],
    dimension_status: "decomposed",
  },
  {
    dimension: "energetics",
    insight: "修炼本质是编译",
    units: [{ id: "u3", dimension: "energetics", unit_name: "修行", description: "...", follow_up_count: 0, is_irreducible: false }],
    candidates: [],
    dimension_status: "decomposed",
  },
];

describe("S2DecomposeStep", () => {
  it("renders all dimension blocks by id", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} topLevelSummary="" />);
    expect(screen.getByTestId("dimension-ontology")).toBeInTheDocument();
    expect(screen.getByTestId("dimension-energetics")).toBeInTheDocument();
  });

  it("renders top_level_summary", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} topLevelSummary="总览文本" />);
    expect(screen.getByTestId("top-level-summary")).toHaveTextContent("总览文本");
  });

  it("does not render the Stage-2 header or causal_map (both removed 2026-09-08)", () => {
    // The "Stage 2 · 第一性拆解" title was redundant with the StepIndicator
    // above, and the causal_map <pre> was just the dimension-order string
    // ("ontology → energetics → ...") — both were removed to free vertical
    // space. Test as a regression guard so a re-introduction is caught.
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} topLevelSummary="" />);
    expect(screen.queryByText(/Stage 2 · 第一性拆解/)).toBeNull();
    expect(screen.queryByTestId("causal-map")).toBeNull();
  });

  it("does not render the per-unit follow-up button (regression for 2026-09-08 removal)", () => {
    // The 「追问」 affordance was removed per the same-day decision to
    // ignore that requirement. Assert absence so a re-introduction is
    // caught explicitly.
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} topLevelSummary="" />);
    expect(screen.queryByTestId("follow-up-u1")).toBeNull();
    expect(screen.queryByTestId("follow-up-u3")).toBeNull();
  });

  it("survives undefined dimensions without crashing (defense-in-depth)", () => {
    // Regression for proj_3ca6fad7-style flow: if any caller passes
    // `dimensions={undefined}`, S2 used to crash at `dimensions.length`
    // and `dimensions.reduce`. Component now coerces to [].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<S2DecomposeStep dimensions={undefined as any} topLevelSummary="" />);
    // Dimension count text is gone with the header — the regression check
    // is just that the component doesn't throw on undefined dimensions.
    expect(screen.queryAllByTestId(/^dimension-/)).toHaveLength(0);
  });
});
