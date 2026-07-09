import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStage4Impact } from "../../hooks/useStage4Impact";

vi.mock("../../api/client", () => {
  const ApiError = class extends Error {};
  return { default: { analyzeImpact: vi.fn() }, ApiError };
});
import api from "../../api/client";

const fakeReport = {
  project_id: "proj_1",
  modified_files: ["storyos/conflicts.json"],
  entries: [
    { chapter_number: 1, scene_numbers: [1], priority: "P0", reason: "主线冲突升级", affected_assets: ["conflict:1"] },
  ],
  summary: { P0: 1, P1: 0, P2: 0 },
};

describe("useStage4Impact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("run_succeeds_setsReport", async () => {
    vi.mocked(api.analyzeImpact).mockResolvedValueOnce(fakeReport as any);
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    expect(result.current.report).toEqual(fakeReport);
    expect(result.current.error).toBeNull();
  });

  it("run_fails_setsError", async () => {
    vi.mocked(api.analyzeImpact).mockRejectedValueOnce(new Error("LLM down"));
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    expect(result.current.report).toBeNull();
    expect(result.current.error).toBe("LLM down");
  });

  it("clear_emptiesReport", async () => {
    vi.mocked(api.analyzeImpact).mockResolvedValueOnce(fakeReport as any);
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    act(() => result.current.clear());
    expect(result.current.report).toBeNull();
  });
});
