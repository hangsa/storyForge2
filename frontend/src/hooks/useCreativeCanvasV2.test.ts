import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postCanvasV2Init: vi.fn().mockResolvedValue({
      ok: true, session_id: "s1", etag: "e1",
    }),
    getCanvasV2State: vi.fn().mockResolvedValue({
      schema_version: 4, session_id: "s1", _etag: "e1",
      creative_path: [],
      committed: false, committed_at: null,
    }),
    postCanvasV2NextStep: vi.fn().mockResolvedValue({
      step: 1,
      operation: { type: "twist", name: "扭曲", reason: "" },
      options: [
        { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
        { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
        { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
      ],
      quality_warning: null,
    }),
    postCanvasV2Select: vi.fn().mockResolvedValue({
      ok: true, step: 1, selected_option_id: "opt_1_b",
    }),
    postCanvasV2Commit: vi.fn().mockResolvedValue({
      error: false, code: "OK", message: "ok",
      detail: {
        concept: {}, story_dna: {}, source: "canvas",
        committed_at: "2026-09-02T10:00:00",
        concept_preview: {}, story_dna_preview: {},
        novelty_summary: {}, next_step_url: "/x", warnings: [],
      },
    }),
  },
}));

const mockedApi = api as unknown as {
  postCanvasV2Init: ReturnType<typeof vi.fn>;
  getCanvasV2State: ReturnType<typeof vi.fn>;
  postCanvasV2NextStep: ReturnType<typeof vi.fn>;
  postCanvasV2Select: ReturnType<typeof vi.fn>;
  postCanvasV2Commit: ReturnType<typeof vi.fn>;
};

describe("useCreativeCanvasV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loadCanvas fetches state and populates canvas", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.loadCanvas();
    });
    expect(result.current.canvas).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockedApi.getCanvasV2State).toHaveBeenCalledWith("proj_x");
  });

  it("initSession calls postCanvasV2Init then loadCanvas", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.initSession({ prompt: "p", genre_primary: "xianxia" });
    });
    expect(mockedApi.postCanvasV2Init).toHaveBeenCalledWith("proj_x",
      expect.objectContaining({ prompt: "p", genre_primary: "xianxia" }));
  });

  it("nextStep returns operation + 3 options", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    let resp;
    await act(async () => {
      resp = await result.current.nextStep(1);
    });
    expect(resp!.operation.type).toBe("twist");
    expect(resp!.options.length).toBe(3);
  });

  it("selectOption calls API + reloads state", async () => {
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.selectOption(1, "opt_1_b");
    });
    expect(mockedApi.postCanvasV2Select).toHaveBeenCalledWith("proj_x",
      expect.objectContaining({ step: 1, option_id: "opt_1_b" }));
  });

  it("commitCanvas calls API + sets committedAt from resp.detail", async () => {
    // After commit, the hook re-fetches state via loadCanvas(), which calls
    // getCanvasV2State. Mock the post-commit GET to reflect the committed
    // state so the hook's status derivation doesn't reset back to "empty".
    mockedApi.getCanvasV2State.mockResolvedValueOnce({
      schema_version: 4, session_id: "s1", _etag: "e2",
      creative_path: [], committed: true,
      committed_at: "2026-09-02T10:00:00",
    });
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.commitCanvas();
    });
    expect(mockedApi.postCanvasV2Commit).toHaveBeenCalledWith("proj_x");
    expect(result.current.committedAt).toBe("2026-09-02T10:00:00");
    expect(result.current.status).toBe("committed");
  });

  it("canCommit becomes true after 5 completions + step5 completed", async () => {
    mockedApi.getCanvasV2State.mockResolvedValueOnce({
      schema_version: 4,
      session_id: "s1", _etag: "e1",
      creative_path: Array.from({ length: 5 }, (_, i) => ({
        step: i + 1, state: "completed", selected_option_id: `opt_${i + 1}_b`,
        options: [], operation: null, operation_reason: null,
        created_at: "", selected_at: "", regenerated_count: 0,
      })),
      committed: false, committed_at: null,
    });
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.loadCanvas();
    });
    await waitFor(() => expect(result.current.canCommit).toBe(true));
  });

  it("canCommit stays false when stale exists", async () => {
    mockedApi.getCanvasV2State.mockResolvedValueOnce({
      schema_version: 4,
      session_id: "s1", _etag: "e1",
      creative_path: [
        ...Array.from({ length: 4 }, (_, i) => ({
          step: i + 1, state: "completed", selected_option_id: `opt_${i + 1}_b`,
          options: [], operation: null, operation_reason: null,
          created_at: "", selected_at: "", regenerated_count: 0,
        })),
        { step: 5, state: "stale", selected_option_id: null,
          options: [], operation: null, operation_reason: null,
          created_at: "", selected_at: "", regenerated_count: 0 },
      ],
      committed: false, committed_at: null,
    });
    const { result } = renderHook(() => useCreativeCanvasV2("proj_x"));
    await act(async () => {
      await result.current.loadCanvas();
    });
    await waitFor(() => expect(result.current.canCommit).toBe(false));
  });
});