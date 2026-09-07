import { render, screen, fireEvent } from "@testing-library/react";
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
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId("dimension-ontology")).toBeInTheDocument();
    expect(screen.getByTestId("dimension-energetics")).toBeInTheDocument();
  });

  it("renders causal_map and top_level_summary", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="因果图 A→B" topLevelSummary="总览文本" loading={false} followUpLoadingUnitId={null} onFollowUp={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId("causal-map")).toHaveTextContent("因果图 A→B");
    expect(screen.getByTestId("top-level-summary")).toHaveTextContent("总览文本");
  });

  it("irreducible unit follow-up button is disabled", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId("follow-up-u1")).not.toBeDisabled();
    expect(screen.getByTestId("follow-up-u2")).toBeDisabled();
  });

  it("clicking follow-up shows dialog; submitting with text calls onFollowUp", () => {
    const onFollowUp = vi.fn();
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={onFollowUp} onPrev={vi.fn()} onNext={vi.fn()} />);
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    const input = screen.getByTestId("follow-up-input-u1");
    fireEvent.change(input, { target: { value: "再深入" } });
    fireEvent.click(screen.getByText("确认追问"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", "再深入");
  });

  it("submitting empty follow-up calls onFollowUp with null", () => {
    const onFollowUp = vi.fn();
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={onFollowUp} onPrev={vi.fn()} onNext={vi.fn()} />);
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.click(screen.getByText("确认追问"));
    expect(onFollowUp).toHaveBeenCalledWith("u1", null);
  });

  it("switching follow-up units clears prior text (regression test for state leak)", () => {
    render(<S2DecomposeStep dimensions={MOCK_DIMENSIONS} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    fireEvent.change(screen.getByTestId("follow-up-input-u1"), { target: { value: "STALE" } });
    fireEvent.click(screen.getByTestId("follow-up-u3"));
    expect(screen.getByTestId("follow-up-input-u3")).toHaveValue("");
  });

  it("survives undefined dimensions without crashing (defense-in-depth)", () => {
    // Regression for proj_3ca6fad7-style flow: if any caller passes
    // `dimensions={undefined}`, S2 used to crash at `dimensions.length`
    // and `dimensions.reduce`. Component now coerces to [].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<S2DecomposeStep dimensions={undefined as any} causalMap="" topLevelSummary="" loading={false} followUpLoadingUnitId={null} onFollowUp={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/0 维度 · 0 单元/)).toBeInTheDocument();
  });
});
