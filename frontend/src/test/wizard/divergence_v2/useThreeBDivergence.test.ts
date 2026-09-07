import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useThreeBDivergence,
  hasDownstreamData,
} from "@/components/wizard/divergence_v2/useThreeBDivergence";
import type {
  ThreeBState,
  DimensionDecomposition,
  CommittedConcept,
  NoveltyScores,
} from "@/components/wizard/divergence_v2/types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getThreeBState: vi.fn(),
    postThreeBDecompose: vi.fn(),
    postThreeBFollowUp: vi.fn(),
    postThreeBDiverge: vi.fn(),
    postThreeBRegenerateUnit: vi.fn(),
    postThreeBSelectUnit: vi.fn(),
    postThreeBCommit: vi.fn(),
    postThreeBEditConcept: vi.fn(),
    postThreeBAdvance: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({ __esModule: true, default: mockApi, api: mockApi, ...mockApi }));

// Factory for a fully-formed ThreeBState payload — minimises per-test boilerplate
// while keeping shape explicit so type-mismatch regressions surface clearly.
function makeState(overrides: Partial<ThreeBState> = {}): ThreeBState {
  return {
    schema_version: 2,
    project_id: "p1",
    raw_intent: null,
    decompose_started_at: null,
    decompose_completed_at: null,
    causal_map: "",
    top_level_summary: "",
    dimensions: [],
    diverge_started_at: null,
    diverge_completed_at: null,
    commit_started_at: null,
    commit_completed_at: null,
    committed_concept: null,
    novelty_scores: null,
    ...overrides,
  };
}

function makeDimension(
  overrides: Partial<DimensionDecomposition> = {},
): DimensionDecomposition {
  return {
    dimension: "ontology",
    insight: "Insight",
    units: [],
    candidates: [],
    dimension_status: "decomposed",
    ...overrides,
  };
}

const rawIntent = {
  prompt: "a cyberpunk mystery",
  genre_primary: "sci_fi",
  genre_secondary: null,
};

const committedConcept: CommittedConcept = {
  one_line: "test",
  expanded: "expanded",
  core_tension: "tension",
  tone: "dark",
  logline: "log",
  edited_by_user: false,
};

const noveltyScores: NoveltyScores = {
  market_saturation: 0.3,
  trope_similarity: 0.4,
  contradiction_depth: 0.6,
  discussion_potential: 0.5,
  composite: 0.45,
  grade: "B",
};

describe("useThreeBDivergence reducer (via hook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hydrate returns null (fresh project).
    mockApi.getThreeBState.mockResolvedValue(null);
    // Default: every network call resolves with an empty object so the hook
    // doesn't crash when a test doesn't pre-load a specific response.
    mockApi.postThreeBDecompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postThreeBDiverge.mockResolvedValue({ dimensions: [] });
    mockApi.postThreeBRegenerateUnit.mockResolvedValue({ candidates: [] });
    mockApi.postThreeBSelectUnit.mockResolvedValue({ dimension: makeDimension() });
    mockApi.postThreeBCommit.mockResolvedValue({
      committed_concept: committedConcept,
      novelty_scores: noveltyScores,
    });
    mockApi.postThreeBEditConcept.mockResolvedValue({ committed_concept: committedConcept });
    mockApi.postThreeBAdvance.mockResolvedValue({ committed_at: "2026-09-07" });
    mockApi.postThreeBFollowUp.mockResolvedValue({
      unit: {
        id: "u1",
        dimension: "ontology",
        unit_name: "n",
        description: "d",
        follow_up_count: 1,
        is_irreducible: false,
      },
    });
  });

  it("JUMP_TO_STAGE only switches currentSubStage, keeps data intact", async () => {
    // Hydrate with dimensions + candidates so downstream state exists.
    mockApi.getThreeBState.mockResolvedValueOnce(
      makeState({
        raw_intent: rawIntent,
        dimensions: [
          makeDimension({
            candidates: [
              {
                id: "c1",
                unit_id: "u1",
                unit_name: "u1",
                description: "d",
                chain_reaction: "r",
                main_operator: "distort",
                aux_operator: null,
                selection_rank: 0,
              },
            ],
          }),
        ],
        causal_map: "cm",
        top_level_summary: "ts",
      }),
    );

    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() =>
      expect(result.current.state.dimensions.length).toBe(1),
    );
    // Sanity: hydrate lands us on stage 3 (candidates exist).
    expect(result.current.state.currentSubStage).toBe("3");
    expect(result.current.state.dimensions[0].candidates.length).toBe(1);

    act(() => result.current.jumpToStage("1"));
    expect(result.current.state.currentSubStage).toBe("1");
    // Data preserved.
    expect(result.current.state.dimensions.length).toBe(1);
    expect(result.current.state.dimensions[0].candidates.length).toBe(1);
    expect(result.current.state.causalMap).toBe("cm");
    expect(result.current.state.topLevelSummary).toBe("ts");
    expect(result.current.state.rawIntent).toEqual(rawIntent);
  });

  it("DECOMPOSE_SUCCESS marks stage 2 completed, advances currentSubStage to 2", async () => {
    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() => expect(result.current.state.completedSubStages).toEqual([]));

    // Pre-stage any prior committed data so we can prove DECOMPOSE clears it.
    act(() => {
      result.current.jumpToStage("4");
    });

    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [makeDimension()],
      causal_map: "new cm",
      top_level_summary: "new ts",
    });

    await act(async () => {
      await result.current.decompose(rawIntent);
    });

    expect(result.current.state.dimensions.length).toBe(1);
    expect(result.current.state.causalMap).toBe("new cm");
    expect(result.current.state.topLevelSummary).toBe("new ts");
    expect(result.current.state.completedSubStages).toContain("2");
    expect(result.current.state.currentSubStage).toBe("2");
  });

  it("DIVERGE_SUCCESS clears committedConcept + noveltyScores and marks stage 3 completed", async () => {
    // Hydrate already-committed.
    mockApi.getThreeBState.mockResolvedValueOnce(
      makeState({
        committed_concept: committedConcept,
        novelty_scores: noveltyScores,
      }),
    );

    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() =>
      expect(result.current.state.committedConcept).not.toBeNull(),
    );
    expect(result.current.state.currentSubStage).toBe("4");

    mockApi.postThreeBDiverge.mockResolvedValueOnce({
      dimensions: [
        makeDimension({
          candidates: [
            {
              id: "c1",
              unit_id: "u1",
              unit_name: "u1",
              description: "d",
              chain_reaction: "r",
              main_operator: "distort",
              aux_operator: null,
              selection_rank: 0,
            },
          ],
        }),
      ],
    });

    await act(async () => {
      await result.current.diverge();
    });

    // Downstream cleared.
    expect(result.current.state.committedConcept).toBeNull();
    expect(result.current.state.noveltyScores).toBeNull();
    // Stage 3 advanced + completed.
    expect(result.current.state.currentSubStage).toBe("3");
    expect(result.current.state.completedSubStages).toContain("3");
    expect(result.current.state.dimensions[0].candidates.length).toBe(1);
  });

  it("COMMIT_SUCCESS advances to stage 4 and marks it completed", async () => {
    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));

    await act(async () => {
      await result.current.commit();
    });

    expect(result.current.state.currentSubStage).toBe("4");
    expect(result.current.state.completedSubStages).toContain("4");
    expect(result.current.state.committedConcept).toEqual(committedConcept);
    expect(result.current.state.noveltyScores).toEqual(noveltyScores);
  });

  it("HYDRATE with state=null sets showUpgradeToast=true and resets to initial state", async () => {
    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() => expect(result.current.state.showUpgradeToast).toBe(true));
    expect(result.current.state.dimensions).toEqual([]);
    expect(result.current.state.committedConcept).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE tolerates getThreeBState rejection (404 → no-state path)", async () => {
    // Regression for proj_3ca6fad7 (2026-09-07): backend returns 404
    // "state 不存在" when no three-b state file exists. The hook must
    // treat that as null state, not crash the reducer.
    mockApi.getThreeBState.mockRejectedValueOnce(new Error("404"));
    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() => expect(result.current.state.showUpgradeToast).toBe(true));
    expect(result.current.state.dimensions).toEqual([]);
    expect(result.current.state.committedConcept).toBeNull();
  });

  it("HYDRATE tolerates malformed payload (missing dimensions field)", async () => {
    // Regression for proj_3ca6fad7 (2026-09-07): if the request helper
    // leaks a FastAPI {"detail": "..."} envelope (no error field), the
    // hook used to dispatch HYDRATE with that string-wrapped object and
    // crash the reducer at `s.dimensions.length`. Reducer now defends
    // against partial shapes.
    mockApi.getThreeBState.mockResolvedValueOnce({} as any);
    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() => expect(result.current.state.dimensions).toEqual([]));
    expect(result.current.state.committedConcept).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE with non-null state computes completedSubStages + currentSubStage from state shape", async () => {
    mockApi.getThreeBState.mockResolvedValueOnce(
      makeState({
        raw_intent: rawIntent,
        dimensions: [
          makeDimension({
            candidates: [
              {
                id: "c1",
                unit_id: "u1",
                unit_name: "u1",
                description: "d",
                chain_reaction: "r",
                main_operator: "distort",
                aux_operator: null,
                selection_rank: 0,
              },
            ],
          }),
        ],
        committed_concept: committedConcept,
        novelty_scores: noveltyScores,
      }),
    );

    const { result } = renderHook(() => useThreeBDivergence("p1"));
    await waitFor(() =>
      expect(result.current.state.dimensions.length).toBe(1),
    );

    // Stages 1, 2, 3, 4 all completed because candidates exist AND commit exists.
    expect(result.current.state.completedSubStages).toEqual(["1", "2", "3", "4"]);
    // Committed => currentSubStage = "4".
    expect(result.current.state.currentSubStage).toBe("4");
  });
});

describe("hasDownstreamData", () => {
  // We only need the fields the helper reads, so a structural cast is safe.
  const empty = { dimensions: [], committedConcept: null } as any;
  const withDims = {
    dimensions: [{ candidates: [] }],
    committedConcept: null,
  } as any;
  const withCandidates = {
    dimensions: [{ candidates: [{}] }],
    committedConcept: null,
  } as any;
  const committed = { dimensions: [], committedConcept: {} } as any;

  it("stage 2: false when empty, true with dims or committed", () => {
    expect(hasDownstreamData(empty, "2")).toBe(false);
    expect(hasDownstreamData(withDims, "2")).toBe(true);
    expect(hasDownstreamData(committed, "2")).toBe(true);
  });

  it("stage 3: false without candidates, true with candidates or committed", () => {
    expect(hasDownstreamData(withDims, "3")).toBe(false);
    expect(hasDownstreamData(withCandidates, "3")).toBe(true);
    expect(hasDownstreamData(committed, "3")).toBe(true);
  });

  it("stage 4: only true with committed", () => {
    expect(hasDownstreamData(empty, "4")).toBe(false);
    expect(hasDownstreamData(withCandidates, "4")).toBe(false);
    expect(hasDownstreamData(committed, "4")).toBe(true);
  });
});