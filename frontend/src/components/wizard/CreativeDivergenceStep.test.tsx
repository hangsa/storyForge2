import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import api from "../../api/client";
import { WizardProvider } from "./WizardContext";

// Tests for the 5-substage rewrite (Plan Task 24, 2026-08-30). The component
// fetches /creative/diverge/state on mount, infers SubStage (A/B/C/D/E), and
// conditionally renders the corresponding substep. ContinueBanner shows when
// a draft already exists.
vi.mock("../../api/client", () => ({
  default: {
    getDivergeState: vi.fn(),
    postDivergeInit: vi.fn().mockResolvedValue({}),
    postDivergeMutate: vi.fn().mockResolvedValue({
      new_node: { id: "v1", title: "变体1" },
      mutation_result: { core_premise: "变体1", novelty_hook: "x", operation: "inversion" },
    }),
    putDivergeContradict: vi.fn().mockResolvedValue({
      core_contradiction: {
        template_type: "T1",
        statement: "矛盾",
        side_a: "A",
        side_b: "B",
        tension_score: 80,
        is_custom: false,
        confirmed_at: "2026-08-30T00:00:00Z",
      },
    }),
    postDivergeCommit: vi.fn().mockResolvedValue({
      source: "creative_divergence",
      committed_at: "2026-08-30T00:00:00Z",
    }),
  },
}));

const sampleEmpty = {
  schema_version: 3,
  root_node_id: null,
  raw_intent: null,
  nodes: {},
  edges: [],
  selected_path: [],
  branch_choices: {},
  core_contradiction: null,
  novelty_scores: null,
  idea_variants: [],
};

function renderStep() {
  return render(
    <WizardProvider projectId="proj_test">
      <CreativeDivergenceStep projectId="proj_test" />
    </WizardProvider>,
  );
}

describe("CreativeDivergenceStep (5-substage container)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleEmpty,
    });
  });

  it("renders StepIndicator at top", async () => {
    renderStep();
    await waitFor(() => {
      expect(screen.getByTestId("step-A")).toBeInTheDocument();
    });
    expect(screen.getByTestId("step-B")).toBeInTheDocument();
    expect(screen.getByTestId("step-C")).toBeInTheDocument();
    expect(screen.getByTestId("step-D")).toBeInTheDocument();
    expect(screen.getByTestId("step-E")).toBeInTheDocument();
  });

  it("defaults to S0A on first load (no state)", async () => {
    renderStep();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      ).toBeInTheDocument();
    });
  });

  it("infers substage B when raw_intent present", async () => {
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...sampleEmpty,
      raw_intent: {
        prompt: "一个完整的故事想法,够长够详细",
        genre_primary: "修仙",
      },
    });
    renderStep();
    await waitFor(() => {
      expect(screen.getByText("创意变体")).toBeInTheDocument();
    });
  });

  it("infers substage E when state is fully committed (draft exists)", async () => {
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...sampleEmpty,
      raw_intent: {
        prompt: "一个完整的故事想法,够长够详细",
        genre_primary: "修仙",
      },
      idea_variants: [
        {
          id: "v1",
          title: "x",
          premise_one_line: "y",
          mutation_type: "inversion",
          mutation_logic: "z",
          estimated_novelty: 0.5,
          trope_tags: [],
          regenerated_count: 0,
        },
      ],
      core_contradiction: {
        template_type: "T1",
        statement: "矛盾",
        side_a: "A",
        side_b: "B",
        tension_score: 80,
        is_custom: false,
        confirmed_at: "2026-08-30T00:00:00Z",
      },
      selected_path: ["root", "node-1", "node-2"],
    });
    renderStep();
    // Substage E renders S0ECommitStep's "新颖度评估与提交" header.
    await waitFor(() => {
      expect(screen.getByText("新颖度评估与提交")).toBeInTheDocument();
    });
    // ContinueBanner must be visible whenever a draft exists.
    expect(screen.getByTestId("continue-banner")).toBeInTheDocument();
  });

  it("falls back to A when getDivergeState rejects", async () => {
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("网络错误"),
    );
    renderStep();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("continue-banner")).not.toBeInTheDocument();
  });
});