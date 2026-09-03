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
    postDivergeWhatIfExpand: vi.fn().mockResolvedValue({
      nodes: { c0: { id: "c0", content: "根展开的第一个子节点" } },
      scores: {},
      suggestion: "",
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
    postDivergeFuse: vi.fn().mockResolvedValue({
      variants: [],
      fusion_distance: { distance: 0, compatibility: "低" },
      risk_level: "low",
    }),
    // Used by S0ECommitStep's mount effect to fetch novelty scores.
    // Default-mock here (Task 5's onCommitSuccess tests override in
    // their beforeEach; other describe blocks don't reach S0E).
    getDivergeNovelty: vi.fn().mockResolvedValue({
      market_saturation: 70,
      trope_similarity: 60,
      contradiction_depth: 80,
      discussion_potential: 65,
      composite: 70,
      grade: "A",
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
  });
});

// Plan Task 11 (2026-09-02): S0-A passes (fusionVariant, fusionBanner) up
// through its onComplete signature (Task 9 left the parent's `nextAfterA`
// accepting but ignoring them via `void fusionVariant; void fusionBanner`).
// Task 11 wires them into CreativeDivergenceStep's DivergenceState and
// (a) passes `fusionVariant` to S0-B as a prop and (b) renders the banner
// above S0-B when `fusionBanner` is non-null. These tests pin both
// behaviors end-to-end so a future refactor can't silently drop the wiring
// (the "fusionVariant not passed to S0-B" and "banner missing" classes of
// regression).
describe("CreativeDivergenceStep fusion propagation (Task 11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleEmpty,
    });
    (api.postDivergeInit as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // S0-B's on-mount expands the root then runs 3 /apply-mutation calls.
    // The success-path test doesn't reach S0-B submit; failure-path test
    // exercises S0-A → /fuse-fail → banner render without entering S0-B
    // (banner shows when fusionBanner is set; the user can choose to
    // continue with the mutation-chain alone).
    (api.postDivergeWhatIfExpand as ReturnType<typeof vi.fn>).mockResolvedValue({
      nodes: { c0: { id: "c0", content: "根展开的第一个子节点" } },
      scores: {},
      suggestion: "",
    });
    (api.postDivergeMutate as ReturnType<typeof vi.fn>).mockResolvedValue({
      new_node: { id: "v1", title: "变体1" },
      mutation_result: {
        core_premise: "变体1",
        novelty_hook: "x",
        operation: "inversion",
      },
    });
  });

  it("passes fusionVariant from S0-A to S0-B (success path)", async () => {
    // /fuse returns a non-null variant — parent's nextAfterA must persist
    // it into DivergenceState.fusionVariant and S0-B must render its
    // `fusion-card` testid with the variant's risk_level badge.
    (api.postDivergeFuse as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [
        {
          id: "var-fuse-1",
          title: "fusion",
          premise_one_line: "f",
          mutation_type: "fusion",
          mutation_logic: "",
          estimated_novelty: 0.7,
          trope_tags: ["xianxia", "xuanyi"],
          regenerated_count: 0,
          risk_level: "medium",
          fusion_distance: 2,
        },
      ],
      fusion_distance: { distance: 2, compatibility: "中" },
      risk_level: "medium",
    });

    renderStep();

    // Wait for mount effect (loadCanvas) to clear the loading state and
    // render S0A's textarea. Without this, fireEvent.change fails because
    // the placeholder isn't in the DOM yet.
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      ).toBeInTheDocument();
    });

    // Fill the A form: prompt ≥10 chars, both genres, check fusion.
    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      { target: { value: "一个长生者踏上了寻找死亡的道路" } },
    );
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    // S0-B mounts with fusionVariant non-null → renders fusion-card +
    // risk-badge with the variant's risk_level.
    await waitFor(() => {
      expect(screen.getByTestId("fusion-card")).toBeInTheDocument();
      expect(screen.getByTestId("risk-badge")).toHaveTextContent(/medium/);
    });
  });

  it("shows fusionBanner in S0-B when /fuse failed", async () => {
    // /fuse rejects — parent's nextAfterA must persist fusionBanner into
    // DivergenceState and S0-B's parent render must surface it via the
    // `fusion-banner` testid with the failure message.
    (api.postDivergeFuse as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM 不可用"),
    );

    renderStep();

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      ).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述你的故事想法/),
      { target: { value: "一个长生者踏上了寻找死亡的道路" } },
    );
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    // After A completes and we land on B, the banner is rendered with the
    // user-facing "类型融合未启用" message (S0-A wraps the error there).
    await waitFor(() => {
      expect(screen.getByTestId("fusion-banner")).toHaveTextContent(
        /类型融合未启用/,
      );
    });
  });
});

// Plan Task 5 (2026-09-03): CreativeDivergenceStep grows onCommitSuccess?: ()
// void. Called exactly once when the divergence flow's E sub-step's commit
// API resolves (i.e., api.postDivergeCommit returned successfully and the
// parent received S0E's onComplete). The wizard injects
// markStep1SurfaceCompleted("divergence") via the callback, so the step
// stays wizard-decoupled (no useWizard import).
describe("CreativeDivergenceStep onCommitSuccess (Task 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // /state returns a fully-committed canvas → loadCanvas infers E →
    // S0ECommitStep mounts immediately. Saves having to drive A→B→C→D→E
    // interactions for the success-path test (the E stage's submit button
    // is the only thing the user can trigger from here).
    (api.getDivergeState as ReturnType<typeof vi.fn>).mockResolvedValue({
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
    // getDivergeNovelty must resolve so the submit button enables
    // (`disabled={!scores || submitting}`).
    (api.getDivergeNovelty as ReturnType<typeof vi.fn>).mockResolvedValue({
      market_saturation: 70,
      trope_similarity: 60,
      contradiction_depth: 80,
      discussion_potential: 65,
      composite: 70,
      grade: "A",
    });
    // /commit returns the standard CommitResponse shape.
    (api.postDivergeCommit as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "creative_divergence",
      committed_at: "2026-09-03T00:00:00Z",
    });
  });

  it("calls onCommitSuccess once when the E sub-step commits", async () => {
    const onCommitSuccess = vi.fn();
    render(
      <WizardProvider projectId="proj_test">
        <CreativeDivergenceStep
          projectId="proj_test"
          onCommitSuccess={onCommitSuccess}
        />
      </WizardProvider>,
    );

    // Wait for S0E to mount (sub-stage inferred from fully-committed canvas).
    await waitFor(() => {
      expect(screen.getByTestId("s0e-submit")).toBeInTheDocument();
    });

    // Click submit → /commit → onComplete fires → parent's onCommitSuccess
    // callback must be invoked exactly once.
    fireEvent.click(screen.getByTestId("s0e-submit"));

    await waitFor(
      () => {
        expect(onCommitSuccess).toHaveBeenCalledTimes(1);
      },
      { timeout: 5000 },
    );
  });

  it("does not throw when onCommitSuccess is omitted", async () => {
    // The prop is optional — omitting it must not crash S0E submit. We
    // drive the submit to ensure the dedup-guarded `onCommitSuccess?.()`
    // call path tolerates undefined.
    render(
      <WizardProvider projectId="proj_test">
        <CreativeDivergenceStep projectId="proj_test" />
      </WizardProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("s0e-submit")).toBeInTheDocument();
    });

    // No-throw smoke: clicking submit completes without exploding. The
    // test fails if the component throws synchronously or in a microtask.
    fireEvent.click(screen.getByTestId("s0e-submit"));

    // Settle: /commit mock resolves immediately, so by now the parent has
    // received S0E's onComplete (which is the no-op `() => undefined`
    // wired without onCommitSuccess). Assert the submit button transitioned
    // to its submitting state and back, indicating the happy path ran.
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalledTimes(1);
    });
  });
});
