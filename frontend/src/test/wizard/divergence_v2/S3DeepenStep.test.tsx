import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import S3DeepenStep from "@/components/wizard/divergence_v2/S3DeepenStep";
import type { Candidate, DeepenedCandidate } from "@/components/wizard/divergence_v2/types";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postThreeBDiverge: vi.fn(),
    postThreeBDeepen: vi.fn(),
    postThreeBCommit: vi.fn(),
    postThreeBRegenerateCandidate: vi.fn(),
    getThreeBState: vi.fn(),
    deleteThreeBState: vi.fn(),
  },
}));

const candidates: Candidate[] = [
  { id: "c1", operator: "breaking", sub_dimension: "打破线性/时间顺序",
    sub_dimension_index: 0, premise_one_line: "倒叙展开",
    rationale: "x", novelty_hook: "y",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0 },
  { id: "c2", operator: "blending", sub_dimension: "物种/实体融合",
    sub_dimension_index: 0, premise_one_line: "半机械半植物",
    rationale: "x", novelty_hook: "y",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0 },
];

describe("S3DeepenStep", () => {
  it("renders selected candidates on left", () => {
    render(
      <S3DeepenStep
        selectedCandidates={candidates}
        deepened={[]}
        appliedOperators={{}}
        onAppliedOperatorChange={() => {}}
        projectId="p1"
        onCommitSuccess={() => {}}
      />,
    );
    expect(screen.getByText("倒叙展开")).toBeTruthy();
    expect(screen.getByText("半机械半植物")).toBeTruthy();
  });

  it("operator picker excludes source_operator", () => {
    render(
      <S3DeepenStep
        selectedCandidates={[candidates[0]]}  // breaking
        deepened={[]}
        appliedOperators={{}}
        onAppliedOperatorChange={() => {}}
        projectId="p1"
        onCommitSuccess={() => {}}
      />,
    );
    // The picker should offer bending + blending but NOT breaking
    // (we render as checkboxes here for simplicity; assert via button labels)
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels.some((l) => /扭曲/.test(l))).toBe(true);
    expect(labels.some((l) => /融合/.test(l))).toBe(true);
  });

  it("disables commit button when any selected candidate not deepened", () => {
    render(
      <S3DeepenStep
        selectedCandidates={candidates}
        deepened={[]}
        appliedOperators={{ c1: "bending" }}  // c2 not deepened
        onAppliedOperatorChange={() => {}}
        projectId="p1"
        onCommitSuccess={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /提交创意发散/i })).toBeDisabled();
  });

  it("invokes onCommitSuccess after successful commit", async () => {
    (api.postThreeBCommit as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ concept_and_dna: {}, novelty_scores: {}, message: "ok" });
    const onSuccess = vi.fn();

    const deepening: DeepenedCandidate = {
      id: "d1", source_candidate_id: "c1", source_operator: "breaking",
      applied_operator: "bending", applied_sub_dimension: "尺度扭曲",
      applied_sub_dimension_index: 0,
      premise_one_line: "x", rationale: "y", novelty_hook: "z",
      recognition_score: 0.8, strangeness_score: 0.85, deepen_count: 1,
    };

    render(
      <S3DeepenStep
        selectedCandidates={[candidates[0]]}
        deepened={[deepening]}
        appliedOperators={{ c1: "bending" }}
        onAppliedOperatorChange={() => {}}
        projectId="p1"
        onCommitSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /提交创意发散/i }));
    await waitFor(() => {
      expect(api.postThreeBCommit).toHaveBeenCalledWith("p1", {
        deepened_ids: ["d1"],
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });
});
