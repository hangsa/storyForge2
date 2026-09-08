import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S4CommitStep from "@/components/wizard/divergence_v2/S4CommitStep";
import type { CommittedConcept, NoveltyScores } from "@/components/wizard/divergence_v2/types";

const MOCK_CONCEPT: CommittedConcept = {
  one_line: "一句话",
  expanded: "扩展",
  core_tension: "张力",
  tone: "暗黑",
  logline: "logline",
  edited_by_user: false,
};

const MOCK_SCORES: NoveltyScores = {
  market_saturation: 0.6, trope_similarity: 0.5, contradiction_depth: 0.7,
  discussion_potential: 0.6, composite: 60, grade: "B+",
};

describe("S4CommitStep", () => {
  it("shows empty state when committedConcept is null", () => {
    render(<S4CommitStep committedConcept={null} noveltyScores={null} onEditConcept={vi.fn()} onRegenerateCommit={vi.fn()} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByText(/尚未合成 concept/)).toBeInTheDocument();
  });

  it("renders all 5 fields and novelty grade", () => {
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={MOCK_SCORES} onEditConcept={vi.fn()} onRegenerateCommit={vi.fn()} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByTestId("committed-one_line")).toHaveTextContent("一句话");
    expect(screen.getByTestId("novelty-scores")).toHaveTextContent(/composite: 60 B\+/);
  });

  it("edit → save calls onEditConcept", () => {
    const onEdit = vi.fn();
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} onEditConcept={onEdit} onRegenerateCommit={vi.fn()} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    fireEvent.click(screen.getByText("编辑"));
    const oneLine = screen.getByTestId("edit-one_line");
    fireEvent.change(oneLine, { target: { value: "新的一句话" } });
    fireEvent.click(screen.getByText("保存编辑"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ one_line: "新的一句话" }));
  });

  it("'重新生成' triggers confirm dialog", () => {
    const onRegen = vi.fn();
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} onEditConcept={vi.fn()} onRegenerateCommit={onRegen} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    fireEvent.click(screen.getByText("重新生成"));
    expect(screen.getByTestId("regen-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("确认重新生成"));
    expect(onRegen).toHaveBeenCalled();
  });

  it("'下一步' is no longer rendered inside S4 (moved to the wizard footer)", () => {
    // S4's internal next/prev footer was removed in the v2.1 divergence-wizard
    // refactor — the page-level wizard footer in WorkspaceWizardPanel now
    // drives sub-stage navigation, with the onAdvance handler registered via
    // setNextHandler in CreativeDivergenceStep. The S4 component no longer
    // renders its own "下一步" button, so we verify it's not present in the
    // tree to catch a regression where someone re-adds an in-stage footer.
    render(<S4CommitStep committedConcept={MOCK_CONCEPT} noveltyScores={null} onEditConcept={vi.fn()} onRegenerateCommit={vi.fn()} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /下一步/ })).toBeNull();
  });

  it("edited_by_user=true shows '用户已编辑' label", () => {
    render(<S4CommitStep committedConcept={{ ...MOCK_CONCEPT, edited_by_user: true }} noveltyScores={null} onEditConcept={vi.fn()} onRegenerateCommit={vi.fn()} onRegenerateAllDivergence={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByText("用户已编辑")).toBeInTheDocument();
  });
});
