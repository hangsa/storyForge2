import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    getThreeBState: vi.fn(),
    postThreeBDiverge: vi.fn(),
    postThreeBDeepen: vi.fn(),
    postThreeBCommit: vi.fn(),
    deleteThreeBState: vi.fn(),
    postThreeBRegenerateCandidate: vi.fn(),
    listGenres: vi.fn().mockResolvedValue([]),
  },
}));

const CANDIDATES = [
  { id: "c1", operator: "breaking", sub_dimension: "打破线性", sub_dimension_index: 0,
    premise_one_line: "倒叙展开", rationale: "r", novelty_hook: "h",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0 },
  { id: "c2", operator: "bending", sub_dimension: "尺度扭曲", sub_dimension_index: 0,
    premise_one_line: "城市大小生物", rationale: "r", novelty_hook: "h",
    recognition_score: 0.7, strangeness_score: 0.6, regenerated_count: 0 },
];

describe("S3→S2 navigation state preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getThreeBState as any).mockResolvedValue({
      schema_version: 1, project_id: "p1", raw_intent: null,
      stage2_candidates: [], stage3_deepened: [], committed: false,
    });
    (api.postThreeBDiverge as any).mockResolvedValue({
      candidates: CANDIDATES,
      by_operator: { breaking: [CANDIDATES[0]], bending: [CANDIDATES[1]], blending: [] },
    });
    (api.postThreeBDeepen as any).mockResolvedValue({
      deepened: {
        id: "d1", source_candidate_id: "c1", source_operator: "breaking",
        applied_operator: "bending", applied_sub_dimension: "尺度扭曲",
        applied_sub_dimension_index: 0, premise_one_line: "深化倒叙", rationale: "r", novelty_hook: "h",
        recognition_score: 0, strangeness_score: 0, deepen_count: 1,
      },
    });
  });

  it("preserves candidates and selections through S3→S2→S3 round-trip", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    // Hydrate completes
    await waitFor(() => expect(screen.getByTestId("step-indicator")).toBeTruthy());

    // Stage 1 → submit → advances to Stage 2
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感测试文本" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "xuanhuan" },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始 3B 发散/i }));

    // Stage 2: candidates should appear, click 1 to select
    await waitFor(() => expect(screen.getByText("倒叙展开")).toBeTruthy());
    fireEvent.click(screen.getByText("倒叙展开"));

    // Click "下一步：深化" → Stage 3
    fireEvent.click(screen.getByRole("button", { name: /下一步.*深化/i }));

    // Stage 3: pick operator for c1 → triggers deepen
    await waitFor(() => expect(screen.getByText("已选候选")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /扭曲/i }));

    // Wait for deepened to appear
    await waitFor(() => expect(screen.getByText("深化倒叙")).toBeTruthy());

    // Now click chip "2. 3B 发散" to navigate back
    const chip2 = screen.getByRole("button", { name: /2\..*3B.*发散/i });
    fireEvent.click(chip2);

    // After going back, candidates should still be visible on S2
    await waitFor(() => {
      // If candidates are preserved, "倒叙展开" should still be there
      expect(screen.queryByText("倒叙展开")).toBeTruthy();
    });
    // The selection should also persist (c1 checkbox should be checked)
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const c1Checkbox = checkboxes[0];
    const c2Checkbox = checkboxes[1];
    expect(c1Checkbox.checked).toBe(true);
    expect(c2Checkbox.checked).toBe(false);

    // Click "下一步：深化" → Stage 3 (round-trip)
    fireEvent.click(screen.getByRole("button", { name: /下一步.*深化/i }));

    // Stage 3 should still show the deepened candidate (state preserved)
    await waitFor(() => expect(screen.queryByText("深化倒叙")).toBeTruthy());

    // Navigate back to S2 via the in-page button (chip would also work but
    // S2 chip is currently disabled because we're on S3, not S2, so chip
    // clickability is only meaningful once we're on S2).
    fireEvent.click(screen.getByRole("button", { name: /2\..*3B.*发散/i }));

    await waitFor(() => expect(screen.queryByText("深化倒叙")).toBeNull());
    // BUG REPRO (pre-fix): the S3 chip was disabled here, leaving the user
    // stuck on S2 with no way to return via the chip indicator.
    // POST-FIX: jumpTo("3") marks "3" as completed, so the S3 chip is
    // clickable here even though the user has not committed.
    const chip3Back = screen.getByRole("button", { name: /3\..*深化提交/i }) as HTMLButtonElement;
    expect(chip3Back.disabled).toBe(false);

    // And the data should still be there when we click the chip back to S3.
    fireEvent.click(chip3Back);
    await waitFor(() => expect(screen.queryByText("深化倒叙")).toBeTruthy());
  });
});
