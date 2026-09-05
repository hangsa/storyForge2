import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S2DivergenceStep from "@/components/wizard/divergence_v2/S2DivergenceStep";
import type { Candidate } from "@/components/wizard/divergence_v2/types";

const candidates: Candidate[] = [
  {
    id: "c1", operator: "breaking", sub_dimension: "打破线性/时间顺序",
    sub_dimension_index: 0, premise_one_line: "倒叙展开",
    rationale: "xx", novelty_hook: "信息倒置",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0,
  },
  {
    id: "c2", operator: "bending", sub_dimension: "尺度扭曲",
    sub_dimension_index: 0, premise_one_line: "城市大小生物",
    rationale: "xx", novelty_hook: "巨型文明",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0,
  },
];

describe("S2DivergenceStep", () => {
  it("renders 3 operator columns", () => {
    render(
      <S2DivergenceStep
        candidates={candidates}
        byOperator={{ breaking: [candidates[0]], bending: [candidates[1]], blending: [] }}
        selectedIds={[]}
        onToggleSelect={() => {}}
        onRegenerateOne={() => {}}
        onRegenerateAll={() => {}}
        onNext={() => {}}
      />,
    );
    // Header now uses split spans: operator label + count chip are siblings,
    // not concatenated text. Verify each label appears with its count.
    expect(screen.getByText("打破")).toBeTruthy();
    expect(screen.getByText("扭曲")).toBeTruthy();
    expect(screen.getByText("融合")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("disables next when nothing selected", () => {
    render(
      <S2DivergenceStep
        candidates={candidates}
        byOperator={{ breaking: [candidates[0]], bending: [candidates[1]], blending: [] }}
        selectedIds={[]}
        onToggleSelect={() => {}}
        onRegenerateOne={() => {}}
        onRegenerateAll={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /下一步.*深化/i })).toBeDisabled();
  });

  it("shows operator-unavailable banner for empty columns", () => {
    render(
      <S2DivergenceStep
        candidates={candidates}
        byOperator={{ breaking: [candidates[0]], bending: [], blending: [] }}
        selectedIds={[]}
        onToggleSelect={() => {}}
        onRegenerateOne={() => {}}
        onRegenerateAll={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getAllByText(/暂不可用/i).length).toBeGreaterThan(0);
  });

  it("invokes onToggleSelect when candidate clicked", () => {
    const onToggle = vi.fn();
    render(
      <S2DivergenceStep
        candidates={candidates}
        byOperator={{ breaking: [candidates[0]], bending: [candidates[1]], blending: [] }}
        selectedIds={[]}
        onToggleSelect={onToggle}
        onRegenerateOne={() => {}}
        onRegenerateAll={() => {}}
        onNext={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("倒叙展开"));
    expect(onToggle).toHaveBeenCalledWith("c1");
  });
});
