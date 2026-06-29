import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStage4Suggestions } from "../../hooks/useStage4Suggestions";

vi.mock("../../api/client", () => ({
  default: { suggestSFLogChanges: vi.fn(), applySFLogSuggestions: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
import api from "../../api/client";

describe("useStage4Suggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("analyze_succeeds_setsReport", async () => {
    const report = { original_text: "a", modified_text: "b", deleted_logs: [], suggestions: [], tokens_used: 0 };
    vi.mocked(api.suggestSFLogChanges).mockResolvedValueOnce(report);
    const { result } = renderHook(() => useStage4Suggestions("proj_1", "scene_1"));
    await act(async () => { await result.current.analyze("a", "b", []); });
    expect(result.current.report).toEqual(report);
  });

  it("analyze_fails_setsError", async () => {
    vi.mocked(api.suggestSFLogChanges).mockRejectedValueOnce(new Error("oops"));
    const { result } = renderHook(() => useStage4Suggestions("proj_1", "scene_1"));
    await act(async () => { await result.current.analyze("a", "b", []); });
    expect(result.current.error).toBe("oops");
  });

  it("apply_callsServerAndReturnsUpdatedText", async () => {
    vi.mocked(api.applySFLogSuggestions).mockResolvedValueOnce({ updated_text: "x" });
    const { result } = renderHook(() => useStage4Suggestions("proj_1", "scene_1"));
    let out!: { updated_text: string };
    await act(async () => { out = await result.current.apply([], "input"); });
    expect(api.applySFLogSuggestions).toHaveBeenCalledWith("proj_1", "scene_1", "input", []);
    expect(out.updated_text).toBe("x");
  });

  it("apply_isIdempotent_sameTextReturned", async () => {
    // Server is responsible for idempotency. The hook just passes through whatever the server returns.
    vi.mocked(api.applySFLogSuggestions).mockResolvedValueOnce({ updated_text: "no_change" });
    const { result } = renderHook(() => useStage4Suggestions("proj_1", "scene_1"));
    let out!: { updated_text: string };
    await act(async () => { out = await result.current.apply([], "same"); });
    expect(out.updated_text).toBe("no_change");
  });

  it("clear_emptiesReport", async () => {
    const report = { original_text: "", modified_text: "", deleted_logs: [], suggestions: [], tokens_used: 0 };
    vi.mocked(api.suggestSFLogChanges).mockResolvedValueOnce(report);
    const { result } = renderHook(() => useStage4Suggestions("proj_1", "scene_1"));
    await act(async () => { await result.current.analyze("", "", []); });
    act(() => result.current.clear());
    expect(result.current.report).toBeNull();
  });

  it("analyze_abortedOnSceneChange", async () => {
    // First call: hangs forever. Second call (after scene change) supersedes.
    let firstResolve!: (v: import("../../api/client").SFLogDiffReport) => void;
    vi.mocked(api.suggestSFLogChanges).mockImplementationOnce(
      () => new Promise<import("../../api/client").SFLogDiffReport>((res) => { firstResolve = res; })
    );
    const { result, rerender } = renderHook(
      ({ sceneId }: { sceneId: string }) => useStage4Suggestions("proj_1", sceneId),
      { initialProps: { sceneId: "scene_1" } }
    );
    let firstAnalyze!: Promise<void>;
    act(() => { firstAnalyze = result.current.analyze("a", "b", []); });
    // Scene changes; hook should abort the first call.
    rerender({ sceneId: "scene_2" });
    // Resolving the first call must NOT update state for scene_2's hook instance.
    act(() => firstResolve({ original_text: "stale", modified_text: "stale", deleted_logs: [], suggestions: [], tokens_used: 0 } as import("../../api/client").SFLogDiffReport));
    await act(async () => { await firstAnalyze; });
    expect(result.current.report).toBeNull();
  });
});
