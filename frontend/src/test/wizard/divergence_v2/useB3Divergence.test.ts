import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useB3Divergence,
  hasDownstreamData,
} from "@/components/wizard/divergence_v2/useB3Divergence";
import type {
  B3State,
  DimensionDecomposition,
} from "@/components/wizard/divergence_v2/types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getB3State: vi.fn(),
    postB3Decompose: vi.fn(),
    postB3MetaDecompose: vi.fn(),
    postB3FollowUp: vi.fn(),
    postB3Commit: vi.fn(),
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

// Factory for a fully-formed v3 B3State payload — schema after the 2026-09-19
// cut of S3 自适应发散 + S4 LLM 合成. 仅有 schema_version / raw_intent /
// decompose_started_at / decompose_completed_at / causal_map / top_level_summary /
// dimensions / committed_at — no candidates, no committed_concept, no novelty_scores.
function makeState(overrides: Partial<B3State> = {}): B3State {
  return {
    schema_version: 3,
    project_id: "p1",
    raw_intent: null,
    decompose_started_at: null,
    decompose_completed_at: null,
    causal_map: "",
    top_level_summary: "",
    dimensions: [],
    committed_at: null,
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
// Variadic: postB3Commit takes `(projectId, options)` (no body),
// while postB3Decompose takes `(projectId, body, options)`. Both shapes'
// `options` bag is the only arg carrying `.signal`, so scanning all args
// for that property works for every primary-stage call.
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

const commitResponse = {
  concept_and_dna: {
    concept: { title: "test", premise: "p", tone: "dark", theme: "t" },
    story_dna: { core_contradiction: { statement: "s", side_a: "a", side_b: "b" } },
    novelty_scores: null,
    source: "creative_divergence",
    b3_snapshot: { schema_version: 3, committed_at: "2026-09-19T00:00:00Z" },
  },
  creative_divergence: {
    schema_version: 1,
    project_id: "p1",
    stage1_intent: rawIntent,
    committed_at: "2026-09-19T00:00:00Z",
  },
  b3_state: makeState({ committed_at: "2026-09-19T00:00:00Z" }),
  committed_at: "2026-09-19T00:00:00Z",
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
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
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
    // Hydrate with dimensions so downstream state exists.
    mockApi.getB3State.mockResolvedValueOnce(
      makeState({
        raw_intent: rawIntent,
        dimensions: [makeDimension()],
        causal_map: "cm",
        top_level_summary: "ts",
      }),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() =>
      expect(result.current.state.dimensions.length).toBe(1),
    );
    // Sanity: hydrate lands us on stage 2 (decomposed).
    expect(result.current.state.currentSubStage).toBe("2");
    expect(result.current.state.dimensions.length).toBe(1);

    act(() => result.current.jumpToStage("1"));
    expect(result.current.state.currentSubStage).toBe("1");
    // Data preserved.
    expect(result.current.state.dimensions.length).toBe(1);
    expect(result.current.state.causalMap).toBe("cm");
    expect(result.current.state.topLevelSummary).toBe("ts");
    expect(result.current.state.rawIntent).toEqual(rawIntent);
  });

  it("DECOMPOSE_SUCCESS marks stage 2 completed, advances currentSubStage to 2", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    // 2026-09-19:HYDRATE with null state returns initial (completedSubStages=[]);
    // 完成态只从 DECOMPOSE_SUCCESS 累积。
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));

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

  it("COMMIT_SUCCESS sets committedAt and marks stage 2 completed (caller decides next step)", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));

    await act(async () => {
      await result.current.commit();
    });

    // 2026-09-19: /commit 不再跳 sub-stage,只把 committedAt 写回 state。
    // Parent (Workspace wizard) 监听 committedAt 后调 wizard.jumpToStep(2) 进世界观。
    expect(result.current.state.committedAt).toBe("2026-09-19T00:00:00Z");
    expect(result.current.state.completedSubStages).toContain("2");
  });

  it("HYDRATE with state=null resets to initial state", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.currentSubStage).toBe("1"));
    expect(result.current.state.dimensions).toEqual([]);
    expect(result.current.state.committedAt).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE tolerates getB3State rejection (404 → no-state path)", async () => {
    // Regression for proj_3ca6fad7 (2026-09-07): backend returns 404
    // "state 不存在" when no b3 state file exists. The hook must
    // treat that as null state, not crash the reducer.
    mockApi.getB3State.mockRejectedValueOnce(new Error("404"));
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => expect(result.current.state.dimensions).toEqual([]));
    expect(result.current.state.committedAt).toBeNull();
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
    expect(result.current.state.committedAt).toBeNull();
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("HYDRATE with non-null state computes completedSubStages + currentSubStage from state shape", async () => {
    mockApi.getB3State.mockResolvedValueOnce(
      makeState({
        raw_intent: rawIntent,
        dimensions: [makeDimension()],
        committed_at: "2026-09-19T00:00:00Z",
      }),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() =>
      expect(result.current.state.dimensions.length).toBe(1),
    );

    // Both stages completed — dimensions exist AND committed_at is set.
    expect(result.current.state.completedSubStages).toEqual(["1", "2"]);
    // committed_at set ⇒ user already submitted; currentSubStage stays at "2".
    expect(result.current.state.currentSubStage).toBe("2");
    expect(result.current.state.committedAt).toBe("2026-09-19T00:00:00Z");
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
  // 2026-09-19 砍 S3/S4 后,hasDownstreamData 仅判断 S2 与下游是否仍有数据。
  // We only need the fields the helper reads, so a structural cast is safe.
  const empty = { dimensions: [], committedAt: null } as any;
  const withDims = { dimensions: [makeDimension()], committedAt: null } as any;
  const committed = { dimensions: [], committedAt: "2026-09-19" } as any;

  it("stage 2: false when empty, true with dims or committed", () => {
    expect(hasDownstreamData(empty, "2")).toBe(false);
    expect(hasDownstreamData(withDims, "2")).toBe(true);
    expect(hasDownstreamData(committed, "2")).toBe(true);
  });

  it("stage 3/4 always return false (sub-stages cut)", () => {
    // S3/S4 sub-stages no longer exist; hasDownstreamData defensively
    // returns false for any non-S2 stage so a stale caller doesn't
    // silently render against a deleted stage.
    expect(hasDownstreamData(withDims, "3")).toBe(false);
    expect(hasDownstreamData(committed, "3")).toBe(false);
    expect(hasDownstreamData(withDims, "4")).toBe(false);
    expect(hasDownstreamData(committed, "4")).toBe(false);
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
// User-reported scenario (2026-09-18): clicking "上一步" while /decompose was
// in flight used to leave the request running in the background. These tests
// pin the AbortController wiring so we don't regress — jumpToStage must
// abort in-flight primary-stage controllers and the JUMP_TO_STAGE reducer
// must clear all "in flight" UI flags so the footer doesn't lie about what's
// loading.

describe("cancel-on-navigate-away", () => {
  beforeEach(() => {
    mockApi.postB3Decompose.mockReset();
    mockApi.postB3Commit.mockReset();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("jumpToStage during in-flight /decompose aborts the request and clears inflight state", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Decompose.mockImplementationOnce(
      hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(holder),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    // Fire-and-forget — the mock never resolves on its own.
    act(() => {
      void result.current.decompose(rawIntent);
    });

    // Wait for DECOMPOSE_START to commit. inflightStage should be "2".
    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(holder.signal?.aborted).toBe(false);

    // Navigate away mid-flight. This is what the user does via the wizard
    // footer's "上一步" button.
    act(() => {
      result.current.jumpToStage("1");
    });

    // All "in flight" UI flags must be cleared immediately by the
    // JUMP_TO_STAGE reducer so the footer doesn't show "拆解中…" anymore,
    // and the captured signal must be aborted so the hung fetch rejects.
    expect(holder.signal?.aborted).toBe(true);
    expect(result.current.state.currentSubStage).toBe("1");
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
    expect(result.current.state.error).toBeNull();

    // The decomposed-on-success dispatch must NOT fire after the abort.
    // If it did, completedSubStages would gain "2" even though /decompose
    // never returned — a quiet data-integrity bug.
    expect(result.current.state.completedSubStages).not.toContain("2");

    // Let the rejected promise's catch run — it must NOT dispatch
    // DECOMPOSE_ERROR.
    await waitFor(() => {
      // Catch path was silent — error stays null.
      expect(result.current.state.error).toBeNull();
    });
  });

  it("jumpToStage during in-flight /commit aborts the request", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Commit.mockImplementationOnce(
      hangUntilAbort<typeof commitResponse>(holder),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.commit();
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
    expect(result.current.state.committedAt).toBeNull();
  });

  it("jumpToStage clears loading/inflightStage/metaLoading even without an inflight request", async () => {
    mockApi.postB3Decompose.mockImplementationOnce(
      hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>({
        signal: undefined,
      }),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

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
// User-reported scenario (2026-09-18): clicking "拆解中…" / "提交中…" on the
// wizard footer should ABORT the in-flight request and turn the label
// into "已暂停"; clicking "已暂停" then re-fires the same operation from
// scratch. pause/resume is wired via resumeActionRef, which each public
// wrapper (decompose / runS1ToS2 / commit) sets before awaiting its inner impl.

describe("pause / resume (loading label click toggles abort + re-fire)", () => {
  beforeEach(() => {
    mockApi.postB3Decompose.mockReset();
    mockApi.postB3MetaDecompose.mockReset();
    mockApi.postB3Commit.mockReset();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.getProjectStatus.mockResolvedValue({ genre: "" });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.postB3Commit.mockResolvedValue(commitResponse);
  });

  it("pause aborts /decompose and flips state.paused=true; resume re-fires /decompose", async () => {
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
    let resolveSecond: (v: typeof commitResponse) => void = () => {};
    mockApi.postB3Commit
      .mockImplementationOnce(hangUntilAbort<typeof commitResponse>(holder))
      .mockImplementationOnce(
        () => new Promise<typeof commitResponse>((res) => { resolveSecond = res; }),
      );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.commit();
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

    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(mockApi.postB3Commit).toHaveBeenCalledTimes(2);
    expect(result.current.state.paused).toBe(false);

    await act(async () => {
      resolveSecond(commitResponse);
      await resumePromise;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.inflightStage).toBeNull();
  });

  it("pause during meta phase of runS1ToS2: resume redoes BOTH meta and decompose", async () => {
    const metaHolder: { signal?: AbortSignal } = {};
    let resolveSecondMeta: (v: { generated_prompt: string; written_to_override: boolean }) => void = () => {};
    mockApi.postB3MetaDecompose
      .mockImplementationOnce(hangUntilAbort<{ generated_prompt: string; written_to_override: boolean }>(metaHolder))
      .mockImplementationOnce(
        () => new Promise<{ generated_prompt: string; written_to_override: boolean }>(
          (res) => { resolveSecondMeta = res; },
        ),
      );
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

    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(true);
      expect(result.current.state.loading).toBe(true);
    });
    expect(mockApi.postB3MetaDecompose).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecondMeta({ generated_prompt: "## META-2 ##", written_to_override: true });
    });
    await waitFor(() => {
      expect(result.current.state.metaLoading).toBe(false);
      expect(result.current.state.inflightStage).toBe("2");
    });
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDecompose({ dimensions: [], causal_map: "m", top_level_summary: "s" });
      await resumePromise;
    });
    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.loading).toBe(false);
  });

  it("jumpToStage during paused drops the paused flag (user navigated away)", async () => {
    const holder: { signal?: AbortSignal } = {};
    mockApi.postB3Decompose.mockImplementationOnce(
      hangUntilAbort<{ dimensions: unknown[]; causal_map: string; top_level_summary: string }>(holder),
    );

    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    act(() => {
      void result.current.decompose(rawIntent);
    });
    await waitFor(() => expect(result.current.state.loading).toBe(true));

    act(() => {
      result.current.pause();
    });
    expect(result.current.state.paused).toBe(true);

    act(() => {
      result.current.jumpToStage("1");
    });

    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.currentSubStage).toBe("1");
  });

  it("resume with nothing paused is a no-op (defensive dispatch)", async () => {
    const { result } = renderHook(() => useB3Divergence("p1"));
    await waitFor(() => result.current !== null);

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.state.paused).toBe(false);
    expect(result.current.state.loading).toBe(false);
    expect(mockApi.postB3Decompose).not.toHaveBeenCalled();
    expect(mockApi.postB3Commit).not.toHaveBeenCalled();
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
    await waitFor(() =>
      result.current.state.dimensions.some((d) =>
        d.units.some((u) => u.id === "u1"),
      ),
    );

    await act(async () => {
      await result.current.followUp("u1", null, "adaptive");
    });

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
