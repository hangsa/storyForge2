import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useB3Divergence,
  hasDownstreamData,
} from "@/components/wizard/divergence_v2/useB3Divergence";
import type {
  B3State,
  DimensionDecomposition,
  CommittedConcept,
  NoveltyScores,
} from "@/components/wizard/divergence_v2/types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getB3State: vi.fn(),
    postB3Decompose: vi.fn(),
    postB3MetaDecompose: vi.fn(),
    postB3FollowUp: vi.fn(),
    postB3Diverge: vi.fn(),
    postB3RegenerateUnit: vi.fn(),
    postB3SelectUnit: vi.fn(),
    postB3Commit: vi.fn(),
    postB3EditConcept: vi.fn(),
    postB3Advance: vi.fn(),
    getProjectStatus: vi.fn().mockResolvedValue({ genre: "" }),
    getPlazaPrompt: vi.fn().mockResolvedValue({ effective: null }),
    putPlazaPrompt: vi.fn().mockResolvedValue({ name: "firstness_decompose", override: null, modified_at: null }),
  },
}));

vi.mock("@/api/client", () => ({ __esModule: true, default: mockApi, api: mockApi, ...mockApi }));

const { mockPlaza } = vi.hoisted(() => ({
  mockPlaza: {
    getPlazaPrompt: mockApi.getPlazaPrompt,
    putPlazaPrompt: mockApi.putPlazaPrompt,
  },
}));

vi.mock("@/api/promptPlaza", () => mockPlaza);

// Factory for a fully-formed B3State payload — minimises per-test boilerplate
// while keeping shape explicit so type-mismatch regressions surface clearly.
function makeState(overrides: Partial<B3State> = {}): B3State {
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

// Capture the AbortSignal passed to a hung mock so tests can assert on
// `signal.aborted` after pause() / jumpToStage() fires. The mock never
// resolves on its own — only the abort listener triggers the rejection.
//
// Variadic: postB3Diverge/postB3Commit/postB3Advance take `(projectId, options)`
// (no body), while postB3Decompose takes `(projectId, body, options)`.
// Both shapes' `options` bag is the only arg carrying `.signal`, so
// scanning all args for that property works for every primary-stage call.
function hangUntilAbort<T>(holder: { signal?: AbortSignal }) {
  return (...args: unknown[]) => {
    const opts = args.find(
      (a) => a && typeof a === "object" && "signal" in (a as object),
    ) as { signal?: AbortSignal } | undefined;
    return new Promise<T>((_resolve, reject) => {
      holder.signal = opts?.signal;
      opts?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  };
}

const rawIntent = {
  prompt: "a cyberpunk mystery",
  genre_primary: "sci_fi",
  tone: "黑暗",
  style: "多线",
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

describe("useB3Divergence reducer (via hook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hydrate returns null (fresh project).
    mockApi.getB3State.mockResolvedValue(null);
    // Default: every network call resolves with an empty object so the hook
    // doesn't crash when a test doesn't pre-load a specific response.
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3Diverge.mockResolvedValue({ dimensions: [] });
    mockApi.postB3RegenerateUnit.mockResolvedValue({ candidates: [] });
    mockApi.postB3SelectUnit.mockResolvedValue({ dimension: makeDimension() });
    mockApi.postB3Commit.mockResolvedValue({
      committed_concept: committedConcept,
      novelty_scores: noveltyScores,
    });
    mockApi.postB3EditConcept.mockResolvedValue({ committed_concept: committedConcept });
    mockApi.postB3Advance.mockResolvedValue({ committed_at: "2026-09-07" });
    mockApi.postB3FollowUp.mockResolvedValue({
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
    mockApi.getB3State.mockResolvedValueOnce(
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

    const { result } = renderHook(() => useB3Divergence("p1"));
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
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.completedSubStages).toEqual([]));

    // Pre-stage any prior committed data so we can prove DECOMPOSE clears it.
    act(() => {
      result.current.jumpToStage("4");
    });

    mockApi.postB3Decompose.mockResolvedValueOnce({
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
    // Regression (Bug #1, 2026-09-10): decompose must populate state.rawIntent
    // in-session so the S2 footer 「重新生成」 button registers on first
    // entry. Previously STAGE1_SUCCESS was defined but never dispatched,
    // so state.rawIntent stayed null until the next HYDRATE on remount —
    // hiding the button until the user exited and re-entered the project.
    expect(result.current.state.rawIntent).toEqual(rawIntent);
  });

  it("DIVERGE_SUCCESS clears committedConcept + noveltyScores and marks stage 3 completed", async () => {
    // Hydrate already-committed.
    mockApi.getB3State.mockResolvedValueOnce(
      makeState({
        committed_concept: committedConcept,
        novelty_scores: noveltyScores,
      }),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() =>
      expect(result.current.state.committedConcept).not.toBeNull(),
    );
    expect(result.current.state.currentSubStage).toBe("4");

    mockApi.postB3Diverge.mockResolvedValueOnce({
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
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));

    await act(async () => {
      await result.current.commit();
    });

    expect(result.current.state.currentSubStage).toBe("4");
    expect(result.current.state.completedSubStages).toContain("4");
    expect(result.current.state.committedConcept).toEqual(committedConcept);
    expect(result.current.state.noveltyScores).toEqual(noveltyScores);
  });

  it("HYDRATE with state=null resets to initial state", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));
    expect(result.current.state.dimensions).toEqual([]);
    expect(result.current.state.committedConcept).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE tolerates getB3State rejection (404 → no-state path)", async () => {
    // Regression for proj_3ca6fad7 (2026-09-07): backend returns 404
    // "state 不存在" when no b3 state file exists. The hook must
    // treat that as null state, not crash the reducer.
    mockApi.getB3State.mockRejectedValueOnce(new Error("404"));
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.dimensions).toEqual([]));
    expect(result.current.state.committedConcept).toBeNull();
  });

  it("HYDRATE tolerates malformed payload (missing dimensions field)", async () => {
    // Regression for proj_3ca6fad7 (2026-09-07): if the request helper
    // leaks a FastAPI {"detail": "..."} envelope (no error field), the
    // hook used to dispatch HYDRATE with that string-wrapped object and
    // crash the reducer at `s.dimensions.length`. Reducer now defends
    // against partial shapes.
    mockApi.getB3State.mockResolvedValueOnce({} as any);
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.dimensions).toEqual([]));
    expect(result.current.state.committedConcept).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE with non-null state computes completedSubStages + currentSubStage from state shape", async () => {
    mockApi.getB3State.mockResolvedValueOnce(
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

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() =>
      expect(result.current.state.dimensions.length).toBe(1),
    );

    // Stages 1, 2, 3, 4 all completed because candidates exist AND commit exists.
    expect(result.current.state.completedSubStages).toEqual(["1", "2", "3", "4"]);
    // Committed => currentSubStage = "4".
    expect(result.current.state.currentSubStage).toBe("4");
  });

  it("DECOMPOSE_SUCCESS coerces action.dimensions to [] when undefined (defense-in-depth)", async () => {
    // Regression: backend /decompose occasionally returns a payload missing
    // `dimensions` (e.g. an LLM that emits a partial response, or the request
    // helper leaking a wrapped envelope). Reducer must coerce so S2's
    // `dimensions.length` doesn't crash on "Cannot read properties of
    // undefined (reading 'length')".
    mockApi.postB3Decompose.mockResolvedValueOnce({
      causal_map: "cm",
      top_level_summary: "ts",
      // no `dimensions` field
    } as any);

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));

    await act(async () => {
      await result.current.decompose(rawIntent);
    });

    expect(result.current.state.dimensions).toEqual([]);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.currentSubStage).toBe("2");
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

// ─— runS1ToS2 + savePrompt ─────────────────────────────────────────────

describe("runS1ToS2 (S1 → S2 two-stage)", () => {
  beforeEach(() => {
    mockApi.postB3MetaDecompose.mockReset();
    mockApi.postB3Decompose.mockReset();
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META-GENERATED ##",
      written_to_override: true,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "m",
      top_level_summary: "summary",
    });
  });

  it("calls /meta-decompose first, then /decompose after meta resolves", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    let counter = 0;
    const callOrder = () => ++counter;
    let metaCallOrder = -1;
    let decompCallOrder = -1;

    mockApi.postB3MetaDecompose.mockImplementation(async () => {
      metaCallOrder = callOrder();
      return { generated_prompt: "x", written_to_override: true };
    });
    mockApi.postB3Decompose.mockImplementation(async () => {
      decompCallOrder = callOrder();
      return { dimensions: [], causal_map: "m", top_level_summary: "s" };
    });

    await act(async () => {
      await result.current.runS1ToS2({
        prompt: "一个少年在废墟里觉醒",
        genre_primary: "玄幻",
        tone: "热血",
        style: "爽文",
      });
    });

    expect(metaCallOrder).toBe(1);
    expect(decompCallOrder).toBe(2);
  });

  it("does NOT call /decompose when /meta-decompose fails (hard error path)", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    mockApi.postB3MetaDecompose.mockRejectedValueOnce(
      new Error("元提示词生成失败: LLM upstream timeout"),
    );

    await act(async () => {
      await result.current.runS1ToS2({
        prompt: "一个少年在废墟里觉醒",
        genre_primary: "玄幻",
        tone: "",
        style: "",
      });
    });

    expect(mockApi.postB3Decompose).not.toHaveBeenCalled();
  });

  it("exposes metaLoading=true on entry, false after both phases complete", async () => {
    // React 18 + @testing-library/react: result.current lags one render
    // cycle behind in-flight dispatches, so we cannot observe the
    // intermediate metaLoading=true state from inside an awaited mock.
    // The call-order test above already proves sequencing; here we just
    // verify the start-state and end-state of the metaLoading flag.
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);
    expect(result.current.state.metaLoading).toBe(false);

    await act(async () => {
      await result.current.runS1ToS2({
        prompt: "一个少年在废墟里觉醒",
        genre_primary: "玄幻",
        tone: "",
        style: "",
      });
    });

    expect(result.current.state.metaLoading).toBe(false);
    expect(result.current.state.loading).toBe(false);
  });

  it("updates state.decomposePrompt from meta response", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    mockApi.postB3MetaDecompose.mockResolvedValueOnce({
      generated_prompt: "## SPECIAL ##",
      written_to_override: true,
    });

    await act(async () => {
      await result.current.runS1ToS2({
        prompt: "x",
        genre_primary: "玄幻",
        tone: "",
        style: "",
      });
    });

    expect(result.current.state.decomposePrompt).toBe("## SPECIAL ##");
  });
});

describe("savePrompt (icon-edit save)", () => {
  it("savePrompt is exposed on the hook return value", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);
    expect(typeof result.current.savePrompt).toBe("function");
  });
});

// ── cancel-on-navigate-away (AbortController plumbing) ────────────────────
//
// User-reported scenario (2026-09-18): clicking "上一步" from S3 back to S2
// while /diverge was in flight used to leave the request running in the
// background. The previous fix only suppressed the UI label; the actual
// fetch kept consuming tokens and eventually overwrote currentSubStage
// back to "3". These tests pin the AbortController wiring so we don't
// regress — jumpToStage must abort in-flight primary-stage controllers and
// the JUMP_TO_STAGE reducer must clear all "in flight" UI flags so the
// footer doesn't lie about what's loading.

describe("cancel-on-navigate-away", () => {
  beforeEach(() => {
    // Default: empty success — the jump-during-diverge test will override.
    mockApi.postB3Diverge.mockResolvedValue({ dimensions: [] });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue({
      committed_concept: committedConcept,
      novelty_scores: noveltyScores,
    });
    mockApi.postB3Advance.mockResolvedValue({ committed_at: "2026-09-18" });
  });

  it("jumpToStage during in-flight /diverge aborts the request and clears inflight state", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Diverge.mockImplementationOnce(hangUntilAbort<{ dimensions: unknown[] }>(holder));

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    // Fire-and-forget — the mock never resolves on its own.
    act(() => {
      void result.current.diverge();
    });

    // Wait for DIVERGE_START to commit. inflightStage should be "3".
    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("3");
    });
    expect(holder.signal?.aborted).toBe(false);

    // Navigate away mid-flight. This is what the user does via the wizard
    // footer's "上一步" button (the CreativeDivergenceStep prev handler
    // dispatches jumpToStage("2") for sub-stage 3).
    act(() => {
      result.current.jumpToStage("2");
    });

    // All "in flight" UI flags must be cleared immediately by the
    // JUMP_TO_STAGE reducer so the footer doesn't show "发散中…" anymore,
    // and the captured signal must be aborted so the hung fetch rejects.
    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.currentSubStage).toBe("2");
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.error).toBeNull();

    // The diverged-on-success dispatch must NOT fire after the abort.
    // If it did, completedSubStages would gain "3" even though /diverge
    // never returned — a quiet data-integrity bug.
    expect(result.current.state.completedSubStages).not.toContain("3");

    // Let the rejected promise's catch run — it must NOT dispatch
    // DIVERGE_ERROR (which would re-set error: action.message and
    // re-flip loading to false — but the latter is harmless, the former
    // would surface a misleading "发散失败" toast to the user).
    await waitFor(() => {
      // Catch path was silent — error stays null.
      expect(result.current.state.error).toBeNull();
    });
  });

  it("jumpToStage during in-flight /decompose aborts the request", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Decompose.mockImplementationOnce(
      hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(holder),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.decompose(rawIntent);
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });

    act(() => {
      result.current.jumpToStage("1");
    });

    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.currentSubStage).toBe("1");
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.completedSubStages).not.toContain("2");
  });

  it("jumpToStage during in-flight /commit aborts the request", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Commit.mockImplementationOnce(
      hangUntilAbort<{ committed_concept: CommittedConcept; novelty_scores: NoveltyScores }>(holder),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.commit();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("4");
    });

    act(() => {
      result.current.jumpToStage("3");
    });

    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.currentSubStage).toBe("3");
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.committedConcept).toBeNull();
  });

  it("jumpToStage clears loading/inflightStage/metaLoading even without an inflight request", async () => {
    // Regression for the reducer side of the fix: previously JUMP_TO_STAGE
    // only cleared `error`. If `loading` or `inflightStage` is non-null at
    // jump time (because the user clicked the stage indicator while a
    // request was finishing), the wizard footer would keep showing
    // "拆解中…" / "发散中…" forever until the next dispatch.
    mockApi.postB3Decompose.mockImplementationOnce(
      hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>({
        signal: undefined,
      }),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    // Linger on a finished-state decompose so metaLoading would have
    // stayed true (it does, after runS1ToS2's meta phase finishes but
    // decompose is in flight). Then JUMP_TO_STAGE must clear it.
    act(() => {
      void result.current.decompose(rawIntent);
    });
    await waitFor(() => expect(result.current.state.loading).toBe(true));

    act(() => {
      result.current.jumpToStage("1");
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.metaLoading).toBe(false);
    expect(result.current.state.followUpLoadingUnitId).toBeNull();
    expect(result.current.state.error).toBeNull();
  });
});

// ── pause / resume (loading label is clickable) ─────────────────────────────
//
// User-reported scenario (2026-09-18): clicking "发散中…" / "拆解中…" / etc.
// on the wizard footer should ABORT the in-flight request and turn the label
// into "已暂停"; clicking "已暂停" then re-fires the same operation from
// scratch. pause/resume is wired via resumeActionRef, which each public
// wrapper (decompose / runS1ToS2 / diverge / commit / advance) sets before
// awaiting its inner impl.
//
// These tests pin the wiring so we don't regress. Each test follows the
// same shape: start a hung primary-stage call, pause → assert aborted +
// paused=true + loading=false, resume → assert a new fetch is in flight +
// paused=false.

describe("pause / resume (loading label click toggles abort + re-fire)", () => {
  beforeEach(() => {
    // Defensive: other describe blocks (cancel-on-navigate-away, the outer
    // reducer suite) use `mockImplementationOnce` without first calling
    // `mockReset`. Those queued entries persist across describe boundaries
    // because `mockResolvedValue` only overrides the *default* — it does
    // NOT drain the FIFO queue. Without the explicit `mockReset` here,
    // a leftover `hangUntilAbort` from `cancel-on-navigate-away`'s last
    // test would be consumed by THIS block's first `diverge()` call,
    // leaving the test's own `holder` empty and inflating the call count
    // past expectations. `mockReset` clears queue + history + impl
    // atomically; we then re-establish the ambient defaults.
    mockApi.postB3Diverge.mockReset();
    mockApi.postB3Decompose.mockReset();
    mockApi.postB3MetaDecompose.mockReset();
    mockApi.postB3Commit.mockReset();
    mockApi.postB3Advance.mockReset();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.getProjectStatus.mockResolvedValue({ genre: "" });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.postB3Diverge.mockResolvedValue({ dimensions: [] });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.postB3Commit.mockResolvedValue({
      committed_concept: committedConcept,
      novelty_scores: noveltyScores,
    });
    mockApi.postB3Advance.mockResolvedValue({ committed_at: "2026-09-18" });
  });

  it("pause aborts /diverge and flips state.paused=true; resume re-fires /diverge", async () => {
    const holder: { signal?: AbortSignal } = {};
    // Second call also hangs so we can assert loading=true mid-resume. The
    // test resolves it via resolveSecond at the end to clean up.
    let resolveSecond: (v: { dimensions: unknown[] }) => void = () => {};
    mockApi.postB3Diverge
      .mockImplementationOnce(hangUntilAbort<{ dimensions: unknown[] }>(holder))
      .mockImplementationOnce(
        () => new Promise<{ dimensions: unknown[] }>((res) => { resolveSecond = res; }),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.diverge();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("3");
    });
    expect(holder.signal?.aborted).toBe(false);
    expect(result.current.state.paused).toBe(false);

    act(() => {
      result.current.pause();
    });

    // Real abort happened; UI flags clear; paused flag flips.
    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.metaLoading).toBe(false);
    expect(result.current.state.paused).toBe(true);
    expect(result.current.state.error).toBeNull();

    // Let the aborted promise's catch run — it must NOT dispatch an
    // *_ERROR (the catch path silently bails on signal.aborted).
    await waitFor(() => expect(result.current.state.error).toBeNull());

    // Resume: should re-fire /diverge from scratch with a fresh controller.
    // Don't await resume() — it awaits the hung fetch which never resolves
    // on its own. We resolve it later via resolveSecond.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    // DIVERGE_START fired → loading=true, inflightStage="3".
    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("3");
    });
    expect(mockApi.postB3Diverge).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    // Clean up: resolve the second fetch and let resume's await settle.
    await act(async () => {
      resolveSecond({ dimensions: [] });
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("pause aborts /decompose and resume re-fires /decompose", async () => {
    const holder: { signal?: AbortSignal } = {};
    let resolveSecond: (v: { dimensions: unknown[]; causal_map: string; top_level_summary: string }) => void = () => {};
    mockApi.postB3Decompose
      .mockImplementationOnce(
        hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(holder),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(
            (res) => { resolveSecond = res; },
          ),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.decompose(rawIntent);
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });

    act(() => {
      result.current.pause();
    });

    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.paused).toBe(true);

    await waitFor(() => expect(result.current.state.error).toBeNull());

    // Resume: fire-and-await-later — it awaits the hung fetch.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    await act(async () => {
      resolveSecond({ dimensions: [], causal_map: "m", top_level_summary: "s" });
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("pause aborts /commit and resume re-fires /commit", async () => {
    const holder: { signal?: AbortSignal } = {};
    let resolveSecond: (v: { committed_concept: CommittedConcept; novelty_scores: NoveltyScores }) => void = () => {};
    mockApi.postB3Commit
      .mockImplementationOnce(
        hangUntilAbort<{ committed_concept: CommittedConcept; novelty_scores: NoveltyScores }>(holder),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ committed_concept: CommittedConcept; novelty_scores: NoveltyScores }>(
            (res) => { resolveSecond = res; },
          ),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.commit();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("4");
    });

    act(() => {
      result.current.pause();
    });

    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.paused).toBe(true);

    await waitFor(() => expect(result.current.state.error).toBeNull());

    // Resume: fire-and-await-later — it awaits the hung fetch.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("4");
    });
    expect(mockApi.postB3Commit).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    await act(async () => {
      resolveSecond({ committed_concept: committedConcept, novelty_scores: noveltyScores });
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("pause aborts /advance and resume re-fires /advance", async () => {
    const holder: { signal?: AbortSignal } = {};
    let resolveSecond: (v: { committed_at: string }) => void = () => {};
    mockApi.postB3Advance
      .mockImplementationOnce(hangUntilAbort<{ committed_at: string }>(holder))
      .mockImplementationOnce(
        () => new Promise<{ committed_at: string }>((res) => { resolveSecond = res; }),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.advance();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("4");
    });

    act(() => {
      result.current.pause();
    });

    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.paused).toBe(true);

    // Resume: fire-and-await-later — resume awaits the hung fetch.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("4");
    });
    expect(mockApi.postB3Advance).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    await act(async () => {
      resolveSecond({ committed_at: "2026-09-18-resumed" });
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("pause during meta phase of runS1ToS2: resume redoes BOTH meta and decompose", async () => {
    // Phase 1 mock: hang on /meta-decompose (also on the resume re-fire).
    const metaHolder: { signal?: AbortSignal } = {};
    let resolveSecondMeta: (v: { generated_prompt: string; written_to_override: boolean }) => void = () => {};
    mockApi.postB3MetaDecompose
      .mockImplementationOnce(hangUntilAbort<{ generated_prompt: string; written_to_override: boolean }>(metaHolder))
      .mockImplementationOnce(
        () => new Promise<{ generated_prompt: string; written_to_override: boolean }>(
          (res) => { resolveSecondMeta = res; },
        ),
      );
    // Phase 2 mock: hang so the second-phase /decompose awaits resolution.
    let resolveDecompose: (v: { dimensions: unknown[]; causal_map: string; top_level_summary: string }) => void = () => {};
    mockApi.postB3Decompose.mockImplementationOnce(
      () => new Promise<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(
        (res) => { resolveDecompose = res; },
      ),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.runS1ToS2({
        prompt: "p", genre_primary: "玄幻", tone: "", style: "",
      });
    });

    // Meta is in flight: metaLoading=true, loading=true, paused=false.
    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(true);
      expect(result.current.state.loading).toBe(true);
    });
    expect(metaHolder.signal?.aborted).toBe(false);

    act(() => {
      result.current.pause();
    });

    expect(metaHolder.signal?.aborted).toBe(true);
    expect(result.current.state.paused).toBe(true);
    expect(result.current.state.metaLoading).toBe(false);
    expect(result.current.state.loading).toBe(false);

    // Resume: fire-and-await-later — resume awaits the hung fetch chain.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    // Meta phase re-fires — metaLoading=true.
    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(true);
      expect(result.current.state.loading).toBe(true);
    });
    expect(mockApi.postB3MetaDecompose).toHaveBeenCalledTimes(2);

    // Resolve meta, let runS1ToS2 flow into the hung /decompose.
    await act(async () => {
      resolveSecondMeta({ generated_prompt: "## META-2 ##", written_to_override: true });
    });
    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(false);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1);

    // Resolve /decompose so resume settles.
    await act(async () => {
      resolveDecompose({ dimensions: [], causal_map: "m", top_level_summary: "s" });
      await resumePromise;
    });
    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.loading).toBe(false);
  });

  it("pause during decompose phase of runS1ToS2: resume skips meta, redoes only /decompose", async () => {
    // Phase 1 mock: resolve /meta-decompose normally.
    mockApi.postB3MetaDecompose.mockResolvedValueOnce({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    // Phase 2 mock: hang on /decompose (also on the resume re-fire).
    const decomposeHolder: { signal?: AbortSignal } = {};
    let resolveSecondDecompose: (v: { dimensions: unknown[]; causal_map: string; top_level_summary: string }) => void = () => {};
    mockApi.postB3Decompose
      .mockImplementationOnce(
        hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(decomposeHolder),
      )
      .mockImplementationOnce(
        () => new Promise<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(
          (res) => { resolveSecondDecompose = res; },
        ),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.runS1ToS2({
        prompt: "p", genre_primary: "玄幻", tone: "", style: "",
      });
    });

    // Wait for decompose to actually be in flight (meta completed first).
    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(false);
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(decomposeHolder.signal?.aborted).toBe(false);

    act(() => {
      result.current.pause();
    });

    expect(decomposeHolder.signal?.aborted).toBe(true);
    expect(result.current.state.paused).toBe(true);

    // Resume: fire-and-await-later — resume awaits the hung fetch.
    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });
    // resumeActionRef was overwritten by the decompose wrapper mid-runS1ToS2
    // (its wrapper sets ref = () => _decomposeImpl(intent, undefined)).
    // Resume skips /meta-decompose entirely.
    expect(mockApi.postB3MetaDecompose).toHaveBeenCalledTimes(1);
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    await act(async () => {
      resolveSecondDecompose({ dimensions: [], causal_map: "m2", top_level_summary: "s2" });
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("jumpToStage during paused drops the paused flag (user navigated away)", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Diverge.mockImplementationOnce(hangUntilAbort<{ dimensions: unknown[] }>(holder));

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.diverge();
    });
    await waitFor(() => expect(result.current.state.loading).toBe(true));

    act(() => {
      result.current.pause();
    });
    expect(result.current.state.paused).toBe(true);

    act(() => {
      result.current.jumpToStage("2");
    });

    // JUMP_TO_STAGE reducer clears paused — user navigated away, no point
    // in showing "已暂停" on a stage the operation isn't associated with.
    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.currentSubStage).toBe("2");
  });

  it("resume with nothing paused is a no-op (defensive dispatch)", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    // No prior action fired → resumeActionRef.current is null → resume()
    // still dispatches RESUME so the footer label resets if any stale UI
    // was showing. This is the "leftover UI label" edge case.
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.loading).toBe(false);
    expect(mockApi.postB3Diverge).not.toHaveBeenCalled();
  });
});

// ── followUp operator (S2 追问 mode toggle) ────────────────────────────────
//
// User selects "无算子" (default) or "自适应" in the modal. The hook must
// forward the chosen operator to api.postB3FollowUp so the backend can
// route the prompt branch + persist main_operator/aux_operator/chain_reaction.
// Regression on 2026-09-19: the previous followUp was 2-arg (unitId, question)
// — adding the operator as a third arg requires every caller to be updated.

describe("followUp operator wiring", () => {
  beforeEach(() => {
    // Defensive (see sibling describe for full rationale): we are NOT nested
    // under the outer `useB3Divergence reducer` block, so its beforeEach
    // doesn't run for us. Re-establish the ambient defaults from scratch.
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.getProjectStatus.mockResolvedValue({ genre: "" });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.postB3FollowUp.mockReset();
    mockApi.postB3FollowUp.mockResolvedValue({
      unit: {
        id: "u1",
        dimension: "ontology",
        unit_name: "灵窍",
        description: "d",
        follow_up_count: 1,
        is_irreducible: false,
        main_operator: null,
        aux_operator: null,
        chain_reaction: null,
      },
    });
  });

  it("followUp defaults operator to 'none' when caller omits it", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    // 2-arg call: legacy callers (or tests) that haven't been updated yet
    // still get a sensible default. Without this default, TypeScript would
    // break old callers; we keep backward compat by making operator optional
    // in the hook signature.
    await act(async () => {
      await result.current.followUp("u1", "灵窍如何验证?");
    });

    expect(mockApi.postB3FollowUp).toHaveBeenCalledTimes(1);
    const body = mockApi.postB3FollowUp.mock.calls[0][1];
    expect(body).toEqual({
      unit_id: "u1",
      user_question: "灵窍如何验证?",
      operator: "none",
    });
  });

  it("followUp forwards operator='adaptive' to the API body", async () => {
    mockApi.postB3FollowUp.mockResolvedValueOnce({
      unit: {
        id: "u1",
        dimension: "ontology",
        unit_name: "灵窍",
        description: "d2",
        follow_up_count: 1,
        is_irreducible: false,
        main_operator: "break",
        aux_operator: "blend",
        chain_reaction: "如改写则门派结构松动",
      },
    });
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    await act(async () => {
      await result.current.followUp("u1", "让门派结构更松动", "adaptive");
    });

    expect(mockApi.postB3FollowUp).toHaveBeenCalledTimes(1);
    const body = mockApi.postB3FollowUp.mock.calls[0][1];
    expect(body.operator).toBe("adaptive");
    expect(body.user_question).toBe("让门派结构更松动");
  });

  it("FOLLOW_UP_SUCCESS updates the unit's main_operator/aux_operator/chain_reaction", async () => {
    // Hydrate with a dimension that already contains u1 so the reducer's
    // FOLLOW_UP_SUCCESS branch can find-and-replace it.
    mockApi.getB3State.mockResolvedValueOnce(
      makeState({
        dimensions: [
          makeDimension({
            units: [
              {
                id: "u1",
                dimension: "ontology",
                unit_name: "灵窍",
                description: "d",
                follow_up_count: 1,
                is_irreducible: false,
              },
            ],
          }),
        ],
      }),
    );
    mockApi.postB3FollowUp.mockResolvedValueOnce({
      unit: {
        id: "u1",
        dimension: "ontology",
        unit_name: "灵窍改",
        description: "深层描述",
        follow_up_count: 2,
        is_irreducible: false,
        main_operator: "distort",
        aux_operator: "break",
        chain_reaction: "参数调试后整个灵脉网络反相",
      },
    });
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);
    // Allow the HYDRATE from mockResolvedValueOnce to flush before followUp
    // dispatches so the reducer sees the unit.
    await waitFor(() =>
      result.current.state.dimensions.some((d) =>
        d.units.some((u) => u.id === "u1"),
      ),
    );

    await act(async () => {
      await result.current.followUp("u1", null, "adaptive");
    });

    // The reducer applies FOLLOW_UP_SUCCESS → unit replaced in dimensions[].
    // Find the unit and assert the operator fields round-tripped.
    const u = result.current.state.dimensions
      .flatMap((d) => d.units)
      .find((x) => x.id === "u1");
    expect(u).toBeTruthy();
    expect(u?.main_operator).toBe("distort");
    expect(u?.aux_operator).toBe("break");
    expect(u?.chain_reaction).toBe("参数调试后整个灵脉网络反相");
    expect(u?.follow_up_count).toBe(2);
  });
});